import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import test from "node:test";
import pg from "pg";
import {submitEditorialReview,transitionEditorialReview} from "../src/editorial-review.ts";
import {readPublishedEditorial} from "../src/published-editorial.ts";

test("public reader returns only the current two-person-approved revision and drops it on withdrawal",async()=>{
 if(!process.env.PGPASSWORD)throw new Error("Disposable PostgreSQL test password required");
 const client=new pg.Client({host:process.env.PGHOST??"localhost",user:process.env.PGUSER??"jfa_ci",
  database:process.env.PGDATABASE??"jfa_ci",password:process.env.PGPASSWORD});
 await client.connect();
 try{
  const [author,reviewerA,reviewerB,entry]=[randomUUID(),randomUUID(),randomUUID(),randomUUID()];
  const slug="synthetic-public-"+randomUUID().slice(0,8);
  const doc={schema_version:1,entry_type:"article",slug,locale:"en",
   title:"A synthetic published article",summary:"Synthetic summary for the public reader test",
   blocks:[{kind:"paragraph",runs:[{text:"Synthetic body text.",emphasis:"normal"}]}],media:[]};
  for(const id of [author,reviewerA,reviewerB])await client.query("INSERT INTO identities(id) VALUES($1)",[id]);
  for(const [id,role] of [[author,"editor"],[reviewerA,"reviewer"],[reviewerA,"editor"],[reviewerB,"reviewer"],[reviewerB,"admin"]])
   await client.query("INSERT INTO role_grants(subject_id,role,resource_scope) VALUES($1,$2,'core')",[id,role]);
  await client.query(`INSERT INTO cms_entries(id,entry_type,slug,locale,visibility,current_revision)
   VALUES($1,'article',$2,'en','private',1)`,[entry,slug]);
  await client.query(`INSERT INTO cms_revisions(entry_id,version,content,author_id,editorial_state,content_hash)
   VALUES($1,1,$2::jsonb,$3,'draft',$4)`,[entry,JSON.stringify(doc),author,"b".repeat(64)]);

  assert.equal(await readPublishedEditorial(client,slug),null,"draft must not be readable");
  const {workflowId}=await submitEditorialReview(client,author,entry,1);
  await transitionEditorialReview(client,reviewerA,workflowId,"approve",2);
  assert.equal(await readPublishedEditorial(client,slug),null,"single approval must not publish");
  await transitionEditorialReview(client,reviewerB,workflowId,"approve",3);
  await transitionEditorialReview(client,reviewerA,workflowId,"publish",4);

  const record=await readPublishedEditorial(client,slug);
  assert.ok(record);
  assert.equal(record.title,doc.title);
  assert.equal(record.version,2);
  assert.match(record.verificationLabel,/not independent verification/);
  const serialized=JSON.stringify(record);
  for(const id of [author,reviewerA,reviewerB,entry])assert.ok(!serialized.includes(id),"internal identifiers must not leak");
  assert.equal(await readPublishedEditorial(client,slug,"fr"),null);
  assert.equal(await readPublishedEditorial(client,"../"+slug),null);

  await transitionEditorialReview(client,reviewerB,workflowId,"withdraw",5);
  assert.equal(await readPublishedEditorial(client,slug),null,"withdrawn content must disappear");
 }finally{await client.end()}
});
