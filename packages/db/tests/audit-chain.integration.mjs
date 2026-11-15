import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import test from "node:test";
import pg from "pg";
import {verifyAuditChain,verifyAuditRows,auditChainHead,listAuditEvents,auditEventHash} from "../src/audit.ts";

const cfg={host:process.env.PGHOST??"localhost",user:process.env.PGUSER??"jfa_ci",password:process.env.PGPASSWORD};
const pool=new pg.Pool({...cfg,database:process.env.PGDATABASE??"jfa_ci",max:6});
const run=async fn=>{const c=await pool.connect();try{return await fn(c);}finally{c.release();}};
test.after(()=>pool.end());

test("concurrent writers produce a gap-free chain that verifies in SQL and independently in Node",async()=>{
 const before=await run(c=>auditChainHead(c));
 await Promise.all(Array.from({length:20},(_,i)=>run(c=>c.query("INSERT INTO audit_events(actor_ref,action,resource_ref,policy_result) VALUES($1,'integration_event',$2,'allow')",[randomUUID(),`test:${i}`]))));
 const after=await run(c=>auditChainHead(c));
 assert.ok(after.seq>=before.seq+20);
 const v=await run(c=>verifyAuditChain(c));
 assert.equal(v.ok,true);assert.equal(v.independent,true);assert.equal(v.firstBadSeq,null);
});

test("pure verifier detects edited content, reordering, gaps and broken links",()=>{
 const mk=(seq,prev,i)=>{const r={seq,previous_hash:prev,event_id:randomUUID(),actor_ref:"a",action:"x_event",resource_ref:`r:${i}`,policy_result:"allow",occurred_at:"2026-11-15T00:00:00.000000Z"};return {...r,event_hash:auditEventHash(r)};};
 const rows=[];let prev="0".repeat(64);
 for(let i=1;i<=4;i++){const r=mk(i,prev,i);rows.push(r);prev=r.event_hash;}
 assert.equal(verifyAuditRows(rows).ok,true);
 assert.deepEqual(verifyAuditRows([...rows.slice(0,2),{...rows[2],action:"y_event"},rows[3]]),{ok:false,firstBadSeq:3,reason:"content_changed"});
 assert.deepEqual(verifyAuditRows([rows[0],rows[2],rows[1],rows[3]]).ok,false);
 assert.deepEqual(verifyAuditRows([rows[0],rows[1],rows[3]]),{ok:false,firstBadSeq:4,reason:"sequence_gap"});
 const forged=mk(2,"f".repeat(64),9);
 assert.deepEqual(verifyAuditRows([rows[0],forged]),{ok:false,firstBadSeq:2,reason:"broken_link"});
});

test("tampering that bypasses triggers is detected by verification",async()=>{
 // A privileged attacker can disable triggers; verification must still catch the edit.
 const dbName="jfa_tamper_"+randomUUID().slice(0,8).replace(/-/g,"");
 await run(c=>c.query(`CREATE DATABASE ${dbName} TEMPLATE ${process.env.PGDATABASE??"jfa_ci"}`)).catch(async()=>{
  // Template copy needs no other sessions; fall back to a fresh migrated database.
  await run(c=>c.query(`CREATE DATABASE ${dbName}`));
 });
 const t=new pg.Client({...cfg,database:dbName});
 await t.connect();
 try{
  const has=await t.query("SELECT to_regclass('audit_chain_head') IS NOT NULL AS ok");
  if(!has.rows[0].ok){const {readdirSync,readFileSync}=await import("node:fs");
   for(const f of readdirSync("db/migrations").filter(f=>/^\d{4}_[a-z0-9_]+\.sql$/.test(f)&&!f.endsWith("_down.sql")).sort())await t.query(readFileSync(`db/migrations/${f}`,"utf8"));}
  for(let i=0;i<3;i++)await t.query("INSERT INTO audit_events(actor_ref,action,resource_ref,policy_result) VALUES('a','tamper_test','r','allow')");
  assert.equal((await verifyAuditChain(t)).ok,true);
  const target=(await t.query("SELECT max(seq)-1 AS s FROM audit_events")).rows[0].s;
  await t.query("SET session_replication_role = replica");
  await t.query("UPDATE audit_events SET policy_result='deny' WHERE seq=$1",[target]);
  await t.query("SET session_replication_role = origin");
  const v=await verifyAuditChain(t);
  assert.equal(v.ok,false);assert.equal(v.firstBadSeq,Number(target));
 }finally{await t.end();await run(c=>c.query(`DROP DATABASE ${dbName} WITH (FORCE)`));}
});

test("audit reading requires audit.read and is itself audited",async()=>{
 const admin=await run(async c=>(await c.query("INSERT INTO identities DEFAULT VALUES RETURNING id")).rows[0].id);
 const editor=await run(async c=>(await c.query("INSERT INTO identities DEFAULT VALUES RETURNING id")).rows[0].id);
 await run(c=>c.query("INSERT INTO role_grants(subject_id,role,resource_scope) VALUES($1,'admin','core'),($2,'editor','core')",[admin,editor]));
 await assert.rejects(run(c=>listAuditEvents(c,editor)),/authorization required/);
 const page=await run(c=>listAuditEvents(c,admin,{limit:5}));
 assert.ok(page.length>0&&page.length<=5);
 assert.ok(page.every((r,i)=>i===0||r.seq<page[i-1].seq));
 const read=await run(c=>c.query("SELECT count(*)::int AS n FROM audit_events WHERE actor_ref=$1 AND action='audit_read'",[admin]));
 assert.equal(read.rows[0].n,1);
});

test("verification stays correct while other sessions keep appending",async()=>{
 let stop=false;
 const writer=(async()=>{while(!stop)await run(c=>c.query("INSERT INTO audit_events(actor_ref,action,resource_ref,policy_result) VALUES('w','concurrent_writer','r','allow')"));})();
 try{
  for(let i=0;i<15;i++){const v=await run(c=>verifyAuditChain(c));assert.equal(v.ok,true,`verification ${i} under load`);}
 }finally{stop=true;await writer;}
});
