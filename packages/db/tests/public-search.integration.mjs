import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import test from "node:test";
import pg from "pg";
import {submitEditorialReview,transitionEditorialReview} from "../src/editorial-review.ts";
import {createEditorialDraft} from "../src/editorial.ts";
import {searchPublicContent,parseSearchQuery} from "../src/public-search.ts";

test("search returns only published content, highlights matches and drops withdrawn items",async()=>{
 const pool=new pg.Pool({host:process.env.PGHOST??"localhost",user:process.env.PGUSER??"jfa_ci",
  database:process.env.PGDATABASE??"jfa_ci",password:process.env.PGPASSWORD,max:4});
 const client=await pool.connect();
 try{
  const [author,ra,rb]=[randomUUID(),randomUUID(),randomUUID()];
  for(const id of [author,ra,rb])await client.query("INSERT INTO identities(id) VALUES($1)",[id]);
  for(const [id,role] of [[author,"editor"],[ra,"reviewer"],[ra,"editor"],[rb,"reviewer"],[rb,"admin"]])
   await client.query("INSERT INTO role_grants(subject_id,role,resource_scope) VALUES($1,$2,'core')",[id,role]);
  const word="xylophonist"+randomUUID().slice(0,6).replace(/[0-9-]/g,"q");
  const make=(slug,type,text)=>({schema_version:1,entry_type:type,slug,locale:"en",
   title:`Synthetic ${type} about ${word}`,summary:"Synthetic summary for search integration",
   blocks:[{kind:"paragraph",runs:[{text,emphasis:"normal"}]}],media:[]});
  const publish=async doc=>{
   const draft=await createEditorialDraft(client,author,doc);
   const {workflowId}=await submitEditorialReview(client,author,draft.entryId,draft.version);
   await transitionEditorialReview(client,ra,workflowId,"approve",2);
   await transitionEditorialReview(client,rb,workflowId,"approve",3);
   await transitionEditorialReview(client,ra,workflowId,"publish",4);
   return workflowId;
  };
  const slugBase="synthetic-search-"+randomUUID().slice(0,8);
  const wf=await publish(make(slugBase+"-a","article",`Documents explain how ${word}s request public records.`));
  await publish(make(slugBase+"-b","faq",`An FAQ mentioning ${word} once.`));
  await createEditorialDraft(client,author,make(slugBase+"-draft","article",`Unpublished draft about ${word}.`));

  const all=await searchPublicContent(client,parseSearchQuery({q:word}));
  assert.equal(all.total,2,"draft must not be searchable");
  assert.ok(all.hits.every(h=>!h.slug.endsWith("-draft")));
  const article=all.hits.find(h=>h.slug===slugBase+"-a");
  assert.ok(article.snippet.some(p=>p.match),"snippet must highlight the match");
  assert.ok(article.snippet.every(p=>!/[\u0002\u0003]/.test(p.text)));
  assert.equal(article.url,`/articles/${slugBase}-a`);
  assert.ok(!JSON.stringify(all).includes(author),"no internal identifiers in results");

  const faqOnly=await searchPublicContent(client,parseSearchQuery({q:word,type:"faq"}));
  assert.deepEqual(faqOnly.hits.map(h=>h.type),["faq"]);
  const stemmed=await searchPublicContent(client,parseSearchQuery({q:`${word} requesting`}));
  assert.equal(stemmed.total,1,"stemming matches request/requesting");
  const page2=await searchPublicContent(client,parseSearchQuery({q:word,page:"2"}));
  assert.equal(page2.hits.length,0);
  const french=await searchPublicContent(client,parseSearchQuery({q:word,locale:"fr"}));
  assert.equal(french.total,0);

  await transitionEditorialReview(client,rb,wf,"withdraw",5);
  const after=await searchPublicContent(client,parseSearchQuery({q:word}));
  assert.equal(after.total,1,"withdrawn content disappears immediately");
 }finally{client.release();await pool.end();}
});
