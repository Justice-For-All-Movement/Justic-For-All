import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import test from "node:test";
import pg from "pg";
import {setPublicName,getOwnProfile} from "../src/pseudonym.ts";
import {recordConsent} from "../src/consent.ts";

const pool=new pg.Pool({host:process.env.PGHOST??"localhost",user:process.env.PGUSER??"jfa_ci",database:process.env.PGDATABASE??"jfa_ci",password:process.env.PGPASSWORD,max:4});
const run=async fn=>{const c=await pool.connect();try{return await fn(c);}finally{c.release();}};
test.after(()=>pool.end());
const identity=()=>run(async c=>(await c.query("INSERT INTO identities DEFAULT VALUES RETURNING id")).rows[0].id);

test("public name needs display consent, is unique, and withdrawal hides it",async()=>{
 const me=await identity(),other=await identity();
 const name=`Synthetic ${randomUUID().slice(0,8).replace(/[0-9]/g,"x")}`;
 assert.deepEqual(await run(c=>setPublicName(c,me,me,name)),{status:"rejected",reason:"consent_required"});
 await run(c=>recordConsent(c,me,me,"public_display_name","grant"));
 assert.deepEqual(await run(c=>setPublicName(c,me,me,"me@example.org")),{status:"rejected",reason:"contact_details"});
 assert.deepEqual(await run(c=>setPublicName(c,me,me,name)),{status:"public"});
 assert.deepEqual(await run(c=>getOwnProfile(c,me)),{name,visibility:"public"});

 await run(c=>recordConsent(c,other,other,"public_display_name","grant"));
 assert.deepEqual(await run(c=>setPublicName(c,other,other,name.toUpperCase())),{status:"rejected",reason:"taken"});
 await assert.rejects(run(c=>setPublicName(c,other,me,"Hijack Name")),/authorization required/,"cannot set someone else's name");

 await run(c=>recordConsent(c,me,me,"public_display_name","withdraw"));
 assert.equal((await run(c=>getOwnProfile(c,me))).visibility,"private","withdrawal hides immediately");
 assert.deepEqual(await run(c=>setPublicName(c,other,other,name)),{status:"public"},"hidden name is free again");
 assert.deepEqual(await run(c=>setPublicName(c,me,me,null)),{status:"private"});
});

test("database rejects malformed or contact-bearing display names even without the service",async()=>{
 const me=await identity();
 await assert.rejects(run(c=>c.query("INSERT INTO profiles(identity_id,public_display_name,visibility) VALUES($1,'x@y.z','public')",[me])),/profiles_display_name_shape/);
 await assert.rejects(run(c=>c.query("INSERT INTO profiles(identity_id,visibility) VALUES($1,'public')",[me])),/profiles_public_needs_name/);
});
