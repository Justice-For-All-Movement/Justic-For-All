import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import {recordConsent,requireConsent,consentStatus,exportConsent,ConsentRequiredError} from "../src/consent.ts";
import {findPurpose} from "../../core/src/consent.ts";

const pool=new pg.Pool({host:process.env.PGHOST??"localhost",user:process.env.PGUSER??"jfa_ci",database:process.env.PGDATABASE??"jfa_ci",password:process.env.PGPASSWORD,max:4});
const run=async fn=>{const c=await pool.connect();try{return await fn(c);}finally{c.release();}};
test.after(()=>pool.end());
const identity=()=>run(async c=>(await c.query("INSERT INTO identities DEFAULT VALUES RETURNING id")).rows[0].id);

test("missing consent rejects optional processing; grant enables; withdrawal stops it",async()=>{
 const me=await identity();
 await assert.rejects(run(c=>requireConsent(c,me,"news_email")),ConsentRequiredError);
 const granted=await run(c=>recordConsent(c,me,me,"news_email","grant"));
 assert.equal(granted.status,"granted");
 await run(c=>requireConsent(c,me,"news_email"));
 await assert.rejects(run(c=>requireConsent(c,me,"volunteer_contact")),ConsentRequiredError,"other purpose not covered");
 await run(c=>recordConsent(c,me,me,"news_email","withdraw"));
 await assert.rejects(run(c=>requireConsent(c,me,"news_email")),ConsentRequiredError);
 const audit=await run(c=>c.query("SELECT action FROM audit_events WHERE actor_ref=$1 ORDER BY occurred_at",[me]));
 assert.deepEqual(audit.rows.map(r=>r.action),["consent_granted","consent_withdrawn"]);
});

test("old-version consent cannot authorize the current policy",async()=>{
 const me=await identity();
 await run(c=>c.query(`INSERT INTO consent_records(subject_ref,purpose,scope,policy_version,decision) VALUES($1,'news_email','core.news_email','2020-01-01','grant')`,[`identity:${me}`]));
 const s=(await run(c=>consentStatus(c,me))).find(x=>x.purpose==="news_email");
 assert.equal(s.status,"reconsent_required");
 await assert.rejects(run(c=>requireConsent(c,me,"news_email")),ConsentRequiredError);
 await run(c=>recordConsent(c,me,me,"news_email","grant"));
 const now=(await run(c=>consentStatus(c,me))).find(x=>x.purpose==="news_email");
 assert.equal(now.policyVersion,findPurpose("news_email").version);
});

test("nobody can record or export consent for someone else; unknown purposes refused",async()=>{
 const me=await identity(),other=await identity();
 await run(c=>c.query("INSERT INTO role_grants(subject_id,role,resource_scope) VALUES($1,'admin','core')",[other]));
 await assert.rejects(run(c=>recordConsent(c,other,me,"news_email","grant")),/authorization required/,"even an admin cannot consent on someone's behalf");
 await assert.rejects(run(c=>exportConsent(c,other,me)),/authorization required/);
 await assert.rejects(run(c=>recordConsent(c,me,me,"sell_my_data","grant")),/Unknown consent purpose/);
 await run(c=>recordConsent(c,me,me,"volunteer_contact","grant"));
 const exp=await run(c=>exportConsent(c,me,me));
 assert.equal(exp.format,"jfa-consent-export/1");
 assert.deepEqual(exp.events.map(e=>[e.purpose,e.decision]),[["volunteer_contact","grant"]]);
 assert.ok(!JSON.stringify(exp).includes(me),"export carries no internal identifiers");
});
