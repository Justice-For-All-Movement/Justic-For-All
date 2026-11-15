import assert from "node:assert/strict";
import {randomBytes,randomUUID} from "node:crypto";
import test from "node:test";
import pg from "pg";
import {createMemoryEmailSender} from "../../adapters/src/email.ts";
import {parseKey,lookupHmac} from "../../security/src/crypto.ts";
import {requestSignInLink,consumeSignInLink,requestAccountDeletion,getSession} from "../src/identity.ts";
import {recordConsent} from "../src/consent.ts";
import {openPrivacyRequest,listOwnRequests,exportOwnData,privacyQueue,setLegalHold,processErasure,closePrivacyRequest} from "../src/privacy.ts";

const pool=new pg.Pool({host:process.env.PGHOST??"localhost",user:process.env.PGUSER??"jfa_ci",database:process.env.PGDATABASE??"jfa_ci",password:process.env.PGPASSWORD,max:4});
const run=async fn=>{const c=await pool.connect();try{return await fn(c);}finally{c.release();}};
test.after(()=>pool.end());
const keys={lookupKey:parseKey(randomBytes(32).toString("base64")),sealKey:parseKey(randomBytes(32).toString("base64"))};
async function account(){
 const sender=createMemoryEmailSender();const deps={...keys,sender,publicOrigin:"https://jfa.example.org"};
 const email=`synthetic.${randomUUID().slice(0,8)}@example.org`;
 await run(c=>requestSignInLink(c,{email,clientKey:randomUUID()},deps));
 const s=await run(c=>consumeSignInLink(c,new URL(sender.outbox[0].text.match(/https?:\/\/\S+/)[0]).searchParams.get("token"),deps));
 return {id:s.identityId,email,session:s.sessionToken};
}
const staff=async role=>run(async c=>{const id=(await c.query("INSERT INTO identities DEFAULT VALUES RETURNING id")).rows[0].id;
 await c.query("INSERT INTO role_grants(subject_id,role,resource_scope) VALUES($1,$2,'core')",[id,role]);return id;});

test("self-service requests and export are strictly own-data",async()=>{
 const me=await account(),other=await account(),admin=await staff("admin");
 await run(c=>recordConsent(c,me.id,me.id,"news_email","grant"));
 assert.deepEqual(await run(c=>openPrivacyRequest(c,me.id,me.id,"correct","")),{status:"invalid"});
 const r=await run(c=>openPrivacyRequest(c,me.id,me.id,"correct","My display name is misspelled."));
 assert.equal(r.status,"received");
 assert.deepEqual(await run(c=>openPrivacyRequest(c,me.id,me.id,"correct","again")),{status:"already_open"});
 await assert.rejects(run(c=>openPrivacyRequest(c,other.id,me.id,"access")),/authorization required/);
 await assert.rejects(run(c=>listOwnRequests(c,other.id,me.id)),/authorization required/,"cannot read another person's requests");
 await assert.rejects(run(c=>exportOwnData(c,admin,me.id)),/authorization required/,"even admins cannot pull a self-service export");
 const data=await run(c=>exportOwnData(c,me.id,me.id));
 assert.equal(data.format,"jfa-personal-data-export/1");
 assert.equal(data.consent[0].purpose,"news_email");
 assert.equal(data.privacyRequests[0].type,"correct");
 assert.ok(!JSON.stringify(data).includes(me.email),"email is never written into downloadable files");
 assert.ok(!JSON.stringify(data).includes(other.id));
 await assert.rejects(run(c=>privacyQueue(c,me.id)),/authorization required/);
 const q=await run(c=>privacyQueue(c,admin));
 const item=q.find(x=>x.id===r.requestId);
 assert.deepEqual(Object.keys(item).sort(),["dueAt","id","legalHold","overdue","status","type"],"queue exposes metadata only");
 await run(c=>closePrivacyRequest(c,admin,r.requestId,"completed","correction_applied"));
 const hist=await run(c=>c.query("SELECT status,actor_ref FROM privacy_request_events WHERE request_id=$1 ORDER BY id",[r.requestId]));
 assert.deepEqual(hist.rows.map(h=>h.status),["identity_or_authority_checked","completed"]);
 await assert.rejects(run(c=>c.query("DELETE FROM privacy_request_events WHERE request_id=$1",[r.requestId])),/append-only/);
});

test("legal hold blocks erasure; without a hold erasure crypto-shreds and propagates",async()=>{
 const held=await account(),gone=await account(),support=await staff("support");
 const {requestId:heldReq}=await run(c=>requestAccountDeletion(c,held.id));
 await run(c=>setLegalHold(c,support,heldReq,true,"court_order_preservation"));
 assert.deepEqual(await run(c=>processErasure(c,support,heldReq)),{status:"denied"});
 const heldState=await run(c=>c.query("SELECT account_state,erased_at FROM identities WHERE id=$1",[held.id]));
 assert.equal(heldState.rows[0].erased_at,null,"held data is preserved");

 await assert.rejects(run(c=>processErasure(c,gone.id,randomUUID())),/authorization required/);
 const {requestId}=await run(c=>requestAccountDeletion(c,gone.id));
 assert.deepEqual(await run(c=>processErasure(c,support,requestId)),{status:"completed"});
 const idRow=await run(c=>c.query("SELECT account_state,erased_at IS NOT NULL AS erased FROM identities WHERE id=$1",[gone.id]));
 assert.deepEqual(idRow.rows[0],{account_state:"deleted",erased:true});
 const contact=await run(c=>c.query("SELECT lookup_hmac,crypto_key_ref,retention_state FROM contact_points WHERE identity_id=$1",[gone.id]));
 assert.deepEqual(contact.rows[0],{lookup_hmac:null,crypto_key_ref:"shredded",retention_state:"erasure_pending"});
 const stillFindable=await run(c=>c.query("SELECT count(*)::int AS n FROM contact_points WHERE lookup_hmac=$1",[lookupHmac(keys.lookupKey,`email:${gone.email}`)]));
 assert.equal(stillFindable.rows[0].n,0,"address can no longer be matched");
 assert.equal(await run(c=>getSession(c,gone.session)),null);
 const ev=await run(c=>c.query("SELECT public_payload FROM outbox_events WHERE event_type='privacy.erasure_completed' AND subject_ref=$1",[`identity:${gone.id}`]));
 assert.deepEqual(ev.rows[0].public_payload,{},"propagation event carries no personal data");
 await assert.rejects(run(c=>processErasure(c,support,requestId)),/not open/,"cannot run twice");
});
