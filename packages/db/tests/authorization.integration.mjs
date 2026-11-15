import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import test from "node:test";
import pg from "pg";
import {authorize,assertAuthorized,grantRole,revokeRole,recordDenial} from "../src/authorization.ts";
import {createEditorialDraft} from "../src/editorial.ts";

const pool=new pg.Pool({host:process.env.PGHOST??"localhost",user:process.env.PGUSER??"jfa_ci",database:process.env.PGDATABASE??"jfa_ci",password:process.env.PGPASSWORD,max:4});
const run=async fn=>{const c=await pool.connect();try{return await fn(c);}finally{c.release();}};
test.after(()=>pool.end());
const identity=()=>run(async c=>(await c.query("INSERT INTO identities DEFAULT VALUES RETURNING id")).rows[0].id);

test("grant lifecycle is admin-only, audited, scoped and revocable",async()=>{
 const admin=await identity(),admin2=await identity(),user=await identity(),editor=await identity();
 await run(c=>c.query("INSERT INTO role_grants(subject_id,role,resource_scope) VALUES($1,'admin','core'),($2,'admin','core')",[admin,admin2]));

 await assert.rejects(run(c=>grantRole(c,editor,{subjectId:user,role:"editor",scope:"core"})),/authorization required/,"non-admin cannot grant");
 await assert.rejects(run(c=>grantRole(c,admin,{subjectId:admin,role:"editor",scope:"core"})),/authorization required/,"no self-grant");
 await assert.rejects(run(c=>grantRole(c,admin,{subjectId:randomUUID(),role:"editor",scope:"core"})),/active identity/,"guessed subject id");
 const {grantId}=await run(c=>grantRole(c,admin,{subjectId:editor,role:"editor",scope:"org:alpha"}));

 assert.equal((await run(c=>authorize(c,editor,"cms.create_draft",{scope:"org:alpha"}))).allowed,true);
 assert.equal((await run(c=>authorize(c,editor,"cms.create_draft",{scope:"core"}))).allowed,false,"org grant does not reach core");
 assert.equal((await run(c=>authorize(c,editor,"cms.publish",{scope:"org:beta"}))).allowed,false);

 await assert.rejects(run(c=>revokeRole(c,editor,grantId)),/authorization required/,"cannot revoke own grant");
 await run(c=>revokeRole(c,admin,grantId));
 assert.equal((await run(c=>authorize(c,editor,"cms.create_draft",{scope:"org:alpha"}))).allowed,false);
 await assert.rejects(run(c=>revokeRole(c,admin,grantId)),/already revoked/);

 const audits=await run(c=>c.query("SELECT action FROM audit_events WHERE actor_ref=$1 AND action IN ('role_granted','role_revoked') ORDER BY occurred_at",[admin]));
 assert.deepEqual(audits.rows.map(r=>r.action),["role_granted","role_revoked"]);
});

test("an administrator can revoke another, who then loses every privilege immediately",async()=>{
 const a=await identity(),b=await identity();
 const ga=(await run(c=>c.query("INSERT INTO role_grants(subject_id,role,resource_scope) VALUES($1,'admin','core') RETURNING id",[a]))).rows[0].id;
 const gb=(await run(c=>c.query("INSERT INTO role_grants(subject_id,role,resource_scope) VALUES($1,'admin','core') RETURNING id",[b]))).rows[0].id;
 await run(c=>revokeRole(c,a,gb));
 assert.equal((await run(c=>authorize(c,b,"roles.manage"))).allowed,false);
 await assert.rejects(run(c=>revokeRole(c,b,ga)),/authorization required/,"revoked admin cannot retaliate");
 assert.equal((await run(c=>authorize(c,a,"roles.manage"))).allowed,true);
});

test("editorial services use the central policy: expired and disabled grants are denied",async()=>{
 const editor=await identity();
 await run(c=>c.query("INSERT INTO role_grants(subject_id,role,resource_scope,created_at,expires_at) VALUES($1,'editor','core',now()-interval '2 days',now()-interval '1 day')",[editor]));
 const doc={schema_version:1,entry_type:"article",slug:"synthetic-authz-"+randomUUID().slice(0,8),locale:"en",title:"Synthetic authorization",summary:"Synthetic summary text here",
  blocks:[{kind:"paragraph",runs:[{text:"Body.",emphasis:"normal"}]}],media:[]};
 await assert.rejects(run(c=>createEditorialDraft(c,editor,doc)),/authorization required/,"expired grant");
 await run(c=>c.query("INSERT INTO role_grants(subject_id,role,resource_scope) VALUES($1,'editor','core')",[editor]));
 await run(c=>createEditorialDraft(c,editor,doc));
 await run(c=>c.query("UPDATE identities SET account_state='disabled' WHERE id=$1",[editor]));
 await assert.rejects(run(c=>assertAuthorized(c,editor,"cms.create_draft")),/authorization required/,"disabled identity");
 await run(c=>recordDenial(c,editor,"cms.create_draft","cms:new"));
 const deny=await run(c=>c.query("SELECT policy_result FROM audit_events WHERE actor_ref=$1 AND action='authz:cms.create_draft'",[editor]));
 assert.equal(deny.rows[0].policy_result,"deny");
});
