import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import test from "node:test";
import pg from "pg";
import {ingestEvent,deliverOutbox,claimOutboxBatch,requeueDeadLetter,OUTBOX_MAX_ATTEMPTS} from "../src/integration.ts";

const pool=new pg.Pool({host:process.env.PGHOST??"localhost",user:process.env.PGUSER??"jfa_ci",database:process.env.PGDATABASE??"jfa_ci",password:process.env.PGPASSWORD,max:6});
const run=async fn=>{const c=await pool.connect();try{return await fn(c);}finally{c.release();}};
test.after(()=>pool.end());

const envelope=(source)=>({event_id:randomUUID(),event_type:"public_projection.published.v1",schema_version:"1.0.0",source_service:source,
 source_resource_id:"rec-1",occurred_at:"2026-11-15T10:00:00Z",projection_version:"v1",classification:"PUBLIC_APPROVED",payload:{public_url:"/records/rec-1",title:"Synthetic"}});

test("inbox: unknown/unverified sources fail closed; events are idempotent",async()=>{
 const slug="synthetic-src-"+randomUUID().slice(0,8);
 assert.deepEqual(await run(c=>ingestEvent(c,envelope(slug),"k1")),{status:"source_not_enabled"});
 await run(c=>c.query("INSERT INTO module_connections(slug,verification_state,enabled) VALUES($1,'unverified',false)",[slug]));
 assert.deepEqual(await run(c=>ingestEvent(c,envelope(slug),"k1")),{status:"source_not_enabled"});
 await run(c=>c.query("UPDATE module_connections SET verification_state='verified',enabled=true,verified_at=now(),approved_at=now(),contract_version='1.0.0',base_url='https://example.org' WHERE slug=$1",[slug]));
 const e=envelope(slug);
 assert.deepEqual(await run(c=>ingestEvent(c,e,"k1")),{status:"accepted"});
 assert.deepEqual(await run(c=>ingestEvent(c,e,"k1")),{status:"duplicate"},"replayed event_id deduplicated");
 const n=await run(c=>c.query("SELECT count(*)::int AS n FROM inbox_events WHERE event_id=$1",[e.event_id]));
 assert.equal(n.rows[0].n,1);
});

const enqueue=(tag)=>run(async c=>(await c.query("INSERT INTO outbox_events(event_type,subject_ref,schema_version,public_payload) VALUES('synthetic.test',$1,'1','{}') RETURNING event_id",[tag])).rows[0].event_id);
const state=id=>run(async c=>(await c.query("SELECT delivery_state,attempts,last_error,next_attempt_at>now() AS backoff FROM outbox_events WHERE event_id=$1",[id])).rows[0]);
const only=ids=>m=>ids.includes(m.eventId);

test("outbox: success, retry with backoff, permanent failure, max attempts, requeue",async()=>{
 const tag="t-"+randomUUID().slice(0,8);
 const ok=await enqueue(tag),retry=await enqueue(tag),perm=await enqueue(tag);
 const ids=[ok,retry,perm];
 const deliver=async m=>!ids.includes(m.eventId)?{ok:false,retryable:true,code:"not_mine"}:m.eventId===ok?{ok:true}:m.eventId===retry?{ok:false,retryable:true,code:"http_503"}:{ok:false,retryable:false,code:"http_400"};
 await run(c=>deliverOutbox(c,deliver,100));
 assert.equal((await state(ok)).delivery_state,"delivered");
 assert.deepEqual(await state(retry),{delivery_state:"failed",attempts:1,last_error:"http_503",backoff:true});
 assert.equal((await state(perm)).delivery_state,"dead_letter");
 // Not due yet: a second run must not retry before backoff elapses.
 const claimed=await run(c=>claimOutboxBatch(c,100));
 assert.ok(!claimed.some(only([retry])));
 await run(c=>c.query("UPDATE outbox_events SET delivery_state='pending', next_attempt_at=NULL WHERE event_id=ANY($1) AND delivery_state='delivering'",[claimed.map(m=>m.eventId)]));
 // Exhaust attempts.
 await run(c=>c.query("UPDATE outbox_events SET attempts=$2,next_attempt_at=NULL WHERE event_id=$1",[retry,OUTBOX_MAX_ATTEMPTS-1]));
 await run(c=>deliverOutbox(c,deliver,100));
 assert.equal((await state(retry)).delivery_state,"dead_letter");
 assert.equal(await run(c=>requeueDeadLetter(c,retry)),true);
 assert.equal((await state(retry)).delivery_state,"pending");
 assert.equal(await run(c=>requeueDeadLetter(c,ok)),false,"delivered messages are not requeued");
});

test("outbox: concurrent workers never claim the same message; expired leases are reclaimed",async()=>{
 const tag="c-"+randomUUID().slice(0,8);
 const ids=[];for(let i=0;i<10;i++)ids.push(await enqueue(tag));
 const [a,b]=await Promise.all([run(c=>claimOutboxBatch(c,100)),run(c=>claimOutboxBatch(c,100))]);
 const mine=[...a,...b].map(m=>m.eventId).filter(id=>ids.includes(id));
 assert.equal(mine.length,10);assert.equal(new Set(mine).size,10,"no double claim");
 await run(c=>c.query("UPDATE outbox_events SET lease_expires_at=now()-interval '1 second' WHERE event_id=ANY($1)",[ids]));
 const again=(await run(c=>claimOutboxBatch(c,100))).map(m=>m.eventId).filter(id=>ids.includes(id));
 assert.equal(again.length,10,"crashed worker's lease is reclaimed");
});
