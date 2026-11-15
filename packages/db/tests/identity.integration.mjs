import assert from "node:assert/strict";
import {randomBytes,randomUUID} from "node:crypto";
import test from "node:test";
import pg from "pg";
import {createMemoryEmailSender,disabledEmailSender} from "../../adapters/src/email.ts";
import {parseKey} from "../../security/src/crypto.ts";
import {requestSignInLink,consumeSignInLink,getSession,signOut,signOutEverywhere,deactivateAccount,requestAccountDeletion,countActiveSessions} from "../src/identity.ts";

const pool=new pg.Pool({host:process.env.PGHOST??"localhost",user:process.env.PGUSER??"jfa_ci",database:process.env.PGDATABASE??"jfa_ci",password:process.env.PGPASSWORD,max:6});
const keys={lookupKey:parseKey(randomBytes(32).toString("base64")),sealKey:parseKey(randomBytes(32).toString("base64"))};
const withClient=async fn=>{const c=await pool.connect();try{return await fn(c);}finally{c.release();}};
const tokenFrom=message=>new URL(message.text.match(/https?:\/\/\S+/)[0]).searchParams.get("token");
test.after(()=>pool.end());

test("email link signs up, signs in, and is single-use; sessions validate and revoke",async()=>{
 const sender=createMemoryEmailSender();
 const deps={...keys,sender,publicOrigin:"https://jfa.example.org"};
 const email=`Synthetic.${randomUUID().slice(0,8)}@Example.org`;
 assert.deepEqual(await withClient(c=>requestSignInLink(c,{email,clientKey:"ip-1"},deps)),{status:"accepted"});
 assert.equal(sender.outbox.length,1);
 const message=sender.outbox[0];
 assert.equal(message.to,email.toLowerCase());
 assert.match(message.text,/^Use this link/);
 assert.ok(message.text.startsWith("Use this link")&&!/case|testimony|evidence/i.test(message.text));
 const token=tokenFrom(message);
 assert.equal(new URL(message.text.match(/https?:\/\/\S+/)[0]).origin,"https://jfa.example.org");

 const first=await withClient(c=>consumeSignInLink(c,token,deps));
 assert.equal(first.status,"signed_in");assert.equal(first.newAccount,true);
 assert.deepEqual(await withClient(c=>consumeSignInLink(c,token,deps)),{status:"invalid_or_expired"},"link is single use");

 // Stored data never contains the clear email or bearer tokens.
 const leak=await withClient(c=>c.query(`SELECT
  (SELECT count(*) FROM contact_points WHERE position(convert_to('example.org','UTF8') IN address_ciphertext)>0)+
  (SELECT count(*) FROM auth_sign_in_tokens WHERE position(convert_to('example.org','UTF8') IN email_sealed)>0) AS n`));
 assert.equal(Number(leak.rows[0].n),0);

 const session=await withClient(c=>getSession(c,first.sessionToken));
 assert.equal(session.identityId,first.identityId);
 assert.equal(await withClient(c=>getSession(c,"x".repeat(43))),null);

 // Returning user: same identity, new session.
 await withClient(c=>requestSignInLink(c,{email:email.toUpperCase(),clientKey:"ip-1"},deps));
 const second=await withClient(c=>consumeSignInLink(c,tokenFrom(sender.outbox[1]),deps));
 assert.equal(second.identityId,first.identityId);assert.equal(second.newAccount,false);
 assert.equal(await withClient(c=>countActiveSessions(c,first.identityId)),2);

 await withClient(c=>signOut(c,first.sessionToken));
 assert.equal(await withClient(c=>getSession(c,first.sessionToken)),null);
 assert.ok(await withClient(c=>getSession(c,second.sessionToken)));
 assert.equal(await withClient(c=>signOutEverywhere(c,first.identityId)),1);
 assert.equal(await withClient(c=>getSession(c,second.sessionToken)),null,"stolen session dies on sign-out everywhere");
});

test("responses do not reveal whether an account exists, is disabled or is throttled",async()=>{
 const sender=createMemoryEmailSender();
 const deps={...keys,sender,publicOrigin:"https://jfa.example.org"};
 const existing=`synthetic.${randomUUID().slice(0,8)}@example.org`;
 await withClient(c=>requestSignInLink(c,{email:existing,clientKey:"ip-2"},deps));
 const signedIn=await withClient(c=>consumeSignInLink(c,tokenFrom(sender.outbox[0]),deps));
 const fresh=`synthetic.${randomUUID().slice(0,8)}@example.org`;
 const a=await withClient(c=>requestSignInLink(c,{email:existing,clientKey:"ip-2"},deps));
 const b=await withClient(c=>requestSignInLink(c,{email:fresh,clientKey:"ip-2"},deps));
 assert.deepEqual(a,b);
 await withClient(c=>deactivateAccount(c,signedIn.identityId));
 const before=sender.outbox.length;
 assert.deepEqual(await withClient(c=>requestSignInLink(c,{email:existing,clientKey:"ip-3"},deps)),{status:"accepted"});
 assert.equal(sender.outbox.length,before,"no link is sent to a disabled account");
 const throttledEmail=`synthetic.${randomUUID().slice(0,8)}@example.org`;
 for(let i=0;i<7;i++)assert.deepEqual(await withClient(c=>requestSignInLink(c,{email:throttledEmail,clientKey:`ip-t${i}`},deps)),{status:"accepted"});
 assert.equal(sender.outbox.filter(m=>m.to===throttledEmail).length,5,"per-address throttle caps links per hour");
 assert.deepEqual(await withClient(c=>requestSignInLink(c,{email:"not-an-email",clientKey:"ip-2"},deps)),{status:"invalid_email"});
 assert.deepEqual(await withClient(c=>requestSignInLink(c,{email:fresh,clientKey:"ip-2"},{...deps,sender:disabledEmailSender})),{status:"unavailable"});
});

test("expired links, disabled accounts and deletion requests fail closed",async()=>{
 const sender=createMemoryEmailSender();
 const past=()=>new Date(Date.now()-20*60_000);
 const email=`synthetic.${randomUUID().slice(0,8)}@example.org`;
 await withClient(c=>requestSignInLink(c,{email,clientKey:"ip-4"},{...keys,sender,publicOrigin:"https://jfa.example.org",now:past}));
 assert.deepEqual(await withClient(c=>consumeSignInLink(c,tokenFrom(sender.outbox[0]),{...keys,sender,publicOrigin:"https://x.org"})),{status:"invalid_or_expired"});

 const deps={...keys,sender,publicOrigin:"https://jfa.example.org"};
 await withClient(c=>requestSignInLink(c,{email,clientKey:"ip-4"},deps));
 const user=await withClient(c=>consumeSignInLink(c,tokenFrom(sender.outbox.at(-1)),deps));
 const {requestId}=await withClient(c=>requestAccountDeletion(c,user.identityId));
 assert.match(requestId,/^[0-9a-f-]{36}$/);
 assert.equal(await withClient(c=>getSession(c,user.sessionToken)),null);
 const state=await withClient(c=>c.query("SELECT account_state FROM identities WHERE id=$1",[user.identityId]));
 assert.equal(state.rows[0].account_state,"disabled");
 const pr=await withClient(c=>c.query("SELECT request_type,status FROM privacy_requests WHERE id=$1",[requestId]));
 assert.deepEqual(pr.rows[0],{request_type:"erase",status:"received"});

 // A link issued before deactivation cannot be used afterwards.
 await withClient(c=>requestSignInLink(c,{email:`x${email}`,clientKey:"ip-5"},deps));
 const other=await withClient(c=>consumeSignInLink(c,tokenFrom(sender.outbox.at(-1)),deps));
 await withClient(c=>requestSignInLink(c,{email:`x${email}`,clientKey:"ip-5"},deps));
 const pending=tokenFrom(sender.outbox.at(-1));
 await withClient(c=>deactivateAccount(c,other.identityId));
 assert.deepEqual(await withClient(c=>consumeSignInLink(c,pending,deps)),{status:"invalid_or_expired"});

 // A different seal key (e.g. after rotation) cannot redeem old links.
 await withClient(c=>requestSignInLink(c,{email:`y${email}`,clientKey:"ip-6"},deps));
 const rotated={...deps,sealKey:parseKey(randomBytes(32).toString("base64"))};
 assert.deepEqual(await withClient(c=>consumeSignInLink(c,tokenFrom(sender.outbox.at(-1)),rotated)),{status:"invalid_or_expired"});
});

test("concurrent first sign-ins for one address create exactly one account",async()=>{
 const sender=createMemoryEmailSender();
 const deps={...keys,sender,publicOrigin:"https://jfa.example.org"};
 const email=`synthetic.${randomUUID().slice(0,8)}@example.org`;
 await withClient(c=>requestSignInLink(c,{email,clientKey:"ip-7"},deps));
 await withClient(c=>requestSignInLink(c,{email,clientKey:"ip-7"},deps));
 const [a,b]=await Promise.all(sender.outbox.map(m=>withClient(c=>consumeSignInLink(c,tokenFrom(m),deps))));
 assert.equal(a.identityId,b.identityId);
 assert.equal([a.newAccount,b.newAccount].filter(Boolean).length,1);
});
