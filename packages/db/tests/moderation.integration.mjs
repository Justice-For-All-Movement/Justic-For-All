import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import test from "node:test";
import pg from "pg";
import {createEditorialDraft} from "../src/editorial.ts";
import {submitEditorialReview,transitionEditorialReview} from "../src/editorial-review.ts";
import {readPublishedEditorial} from "../src/published-editorial.ts";
import {searchPublicContent,parseSearchQuery} from "../src/public-search.ts";
import {submitReport,reportStatus,reportQueue,hideContent,appealAction,decideAppeal,dismissReport} from "../src/moderation.ts";

const pool=new pg.Pool({host:process.env.PGHOST??"localhost",user:process.env.PGUSER??"jfa_ci",database:process.env.PGDATABASE??"jfa_ci",password:process.env.PGPASSWORD,max:4});
const run=async fn=>{const c=await pool.connect();try{return await fn(c);}finally{c.release();}};
test.after(()=>pool.end());
const person=async(...roles)=>run(async c=>{const id=(await c.query("INSERT INTO identities DEFAULT VALUES RETURNING id")).rows[0].id;
 for(const r of roles)await c.query("INSERT INTO role_grants(subject_id,role,resource_scope) VALUES($1,$2,'core')",[id,r]);return id;});

test("report → hide removes content everywhere → author appeal → different reviewer restores",async()=>{
 const author=await person("editor"),ra=await person("reviewer","editor"),rb=await person("reviewer","admin"),rc=await person("reviewer"),reporter=await person();
 const word="moderationword"+randomUUID().slice(0,6).replace(/[0-9-]/g,"z");
 const slug="synthetic-mod-"+randomUUID().slice(0,8);
 const doc={schema_version:1,entry_type:"article",slug,locale:"en",title:`Synthetic ${word} article`,summary:"Synthetic summary for moderation",
  blocks:[{kind:"paragraph",runs:[{text:"Synthetic body.",emphasis:"normal"}]}],media:[]};
 const d=await run(c=>createEditorialDraft(c,author,doc));
 const {workflowId}=await run(c=>submitEditorialReview(c,author,d.entryId,d.version));
 await run(c=>transitionEditorialReview(c,ra,workflowId,"approve",2));
 await run(c=>transitionEditorialReview(c,rb,workflowId,"approve",3));
 await run(c=>transitionEditorialReview(c,ra,workflowId,"publish",4));

 assert.deepEqual(await run(c=>submitReport(c,{slug:"no-such-article",reason:"inaccurate"})),{status:"not_found"});
 assert.deepEqual(await run(c=>submitReport(c,{slug,reason:"lies"})),{status:"invalid"});
 const rep=await run(c=>submitReport(c,{slug,reason:"privacy_exposure",details:"It shows a home address.",reporterId:reporter}));
 assert.equal(rep.status,"received");
 assert.deepEqual(await run(c=>reportStatus(c,rep.receipt)),{status:"received"});

 await assert.rejects(run(c=>reportQueue(c,author)),/authorization required/,"authors cannot browse reports");
 const queue=await run(c=>reportQueue(c,rc));
 const item=queue.find(q=>q.slug===slug);
 assert.ok(item);
 assert.ok(!JSON.stringify(queue).includes(reporter),"reporter identity never reaches reviewers");
 assert.ok(!Object.keys(item).some(k=>/reporter|receipt/i.test(k)));

 const {actionId}=await run(c=>hideContent(c,rc,{reportId:item.reportId,reason:"privacy_exposure"}));
 assert.equal(await run(c=>readPublishedEditorial(c,slug)),null,"held content leaves the public reader");
 assert.equal((await run(c=>searchPublicContent(c,parseSearchQuery({q:word})))).total,0,"and search");
 assert.deepEqual(await run(c=>reportStatus(c,rep.receipt)),{status:"reviewed"});
 const ev=await run(c=>c.query("SELECT count(*)::int AS n FROM outbox_events WHERE event_type='cms.hidden' AND subject_ref=$1",[`cms:${d.entryId}`]));
 assert.equal(ev.rows[0].n,1,"cache invalidation event queued");

 await assert.rejects(run(c=>appealAction(c,reporter,actionId,"I am not the author but want this back.")),/authorization required/,"only the author may appeal");
 const {appealId}=await run(c=>appealAction(c,author,actionId,"The address shown is a public office, not a home."));
 await assert.rejects(run(c=>decideAppeal(c,rc,appealId,"overturned")),/authorization required/,"the hiding reviewer cannot judge the appeal");
 await run(c=>decideAppeal(c,rb,appealId,"overturned"));
 assert.ok(await run(c=>readPublishedEditorial(c,slug)),"improper removal recovered");
 await assert.rejects(run(c=>decideAppeal(c,ra,appealId,"upheld")),/not open/);
 await assert.rejects(run(c=>c.query("UPDATE moderation_actions SET action='restore' WHERE id=$1",[actionId])),/append-only/);
 await assert.rejects(run(c=>c.query("DELETE FROM moderation_actions WHERE id=$1",[actionId])),/append-only/);
});

test("dismissal keeps content public; bad receipts reveal nothing",async()=>{
 const rev=await person("reviewer");
 assert.equal(await run(c=>reportStatus(c,"x".repeat(43))),null);
 assert.equal(await run(c=>reportStatus(c,"../etc")),null);
 const any=await run(c=>c.query("SELECT slug FROM core_public_content LIMIT 1"));
 if(!any.rows[0])return;
 const rep=await run(c=>submitReport(c,{slug:any.rows[0].slug,reason:"other"}));
 const item=(await run(c=>reportQueue(c,rev,200))).find(q=>q.status==="received"&&q.slug===any.rows[0].slug);
 await run(c=>dismissReport(c,rev,item.reportId));
 assert.equal((await run(c=>reportStatus(c,rep.receipt))).status!=="received",true);
});
