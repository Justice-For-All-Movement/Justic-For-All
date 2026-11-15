import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import test from "node:test";
import pg from "pg";
import {parseKey} from "../../security/src/crypto.ts";
import {totpAt,currentStep} from "../../security/src/totp.ts";
import {getSession} from "../src/identity.ts";
import {passkeyRegistrationOptions,verifyPasskeyRegistration,passkeyStepUpOptions,verifyPasskeyStepUp,beginTotpEnrollment,confirmTotpEnrollment,
 stepUpWithTotp,stepUpWithRecoveryCode,authorizeStaffRequest,revokeFactor,hasMfa,relyingPartyFrom,mayEnroll} from "../src/mfa.ts";
import {newBearerToken,tokenDigest} from "../../security/src/crypto.ts";
import {createSoftAuthenticator} from "./helpers/soft-authenticator.mjs";

const pool=new pg.Pool({host:process.env.PGHOST??"localhost",user:process.env.PGUSER??"jfa_ci",database:process.env.PGDATABASE??"jfa_ci",password:process.env.PGPASSWORD,max:4});
const run=async fn=>{const c=await pool.connect();try{return await fn(c);}finally{c.release();}};
test.after(()=>pool.end());
const rp=relyingPartyFrom("https://jfa.example.org");
const deps={...rp,rpName:"Justice For All",sealKey:parseKey(randomBytes(32).toString("base64")),lookupKey:parseKey(randomBytes(32).toString("base64"))};

async function staffSession(role="admin",createdAgoMs=0){
 return run(async c=>{
  const id=(await c.query("INSERT INTO identities DEFAULT VALUES RETURNING id")).rows[0].id;
  if(role)await c.query("INSERT INTO role_grants(subject_id,role,resource_scope) VALUES($1,$2,'core')",[id,role]);
  const token=newBearerToken(),at=new Date(Date.now()-createdAgoMs);
  await c.query(`INSERT INTO auth_sessions(identity_id,token_digest,created_at,last_seen_at,idle_expires_at,absolute_expires_at) VALUES($1,$2,$3,$3,now()+interval '1 day',now()+interval '2 days')`,[id,tokenDigest(token),at]);
  return {id,token,session:await getSession(c,token)};
 });
}

test("relying party comes from APP_PUBLIC_URL and requires https",()=>{
 assert.deepEqual(relyingPartyFrom("https://justice-for-all-web.onrender.com"),{rpID:"justice-for-all-web.onrender.com",origin:"https://justice-for-all-web.onrender.com"});
 assert.equal(relyingPartyFrom("http://evil.example"),null);
});

test("passkey: register on a fresh session, then step-up enables privileged actions for this session only",async()=>{
 const s=await staffSession();
 const auth=createSoftAuthenticator(rp);
 await assert.rejects(run(c=>authorizeStaffRequest(c,s.session,"admin.view")),/authorization required/,"staff without MFA are refused");
 const opts=await run(c=>passkeyRegistrationOptions(c,s.session,deps));
 assert.equal(opts.rp.id,"jfa.example.org");
 assert.equal(opts.authenticatorSelection.userVerification,"required");
 const reg=await run(c=>verifyPasskeyRegistration(c,s.session,auth.register(opts),"Laptop",deps));
 assert.equal(reg.status,"registered");assert.equal(reg.recoveryCodes.length,10);
 assert.deepEqual(await run(c=>verifyPasskeyRegistration(c,s.session,auth.register(opts),"Again",deps)),{status:"rejected"},"challenge is single use");

 await run(c=>authorizeStaffRequest(c,s.session,"admin.view"));
 await assert.rejects(run(c=>authorizeStaffRequest(c,s.session,"roles.manage")),/authorization required/,"privileged needs step-up");
 const so=await run(c=>passkeyStepUpOptions(c,s.session,deps));
 assert.deepEqual(await run(c=>verifyPasskeyStepUp(c,s.session,auth.assert(so,{originOverride:"https://phish.example"}),deps)),{status:"rejected"},"phishing origin rejected");
 const so2=await run(c=>passkeyStepUpOptions(c,s.session,deps));
 assert.deepEqual(await run(c=>verifyPasskeyStepUp(c,s.session,auth.assert(so2),deps)),{status:"stepped_up"});
 await run(c=>authorizeStaffRequest(c,s.session,"roles.manage"));

 // A second session (e.g. a stolen cookie) has no step-up and cannot obtain one without the authenticator.
 const stolen={...s.session,sessionId:(await run(async c=>{const t=newBearerToken();await c.query(`INSERT INTO auth_sessions(identity_id,token_digest,idle_expires_at,absolute_expires_at) VALUES($1,$2,now()+interval '1 day',now()+interval '2 days')`,[s.id,tokenDigest(t)]);return (await getSession(c,t)).sessionId;}))};
 await assert.rejects(run(c=>authorizeStaffRequest(c,stolen,"roles.manage")),/authorization required/);
 const other=createSoftAuthenticator(rp);
 const so3=await run(c=>passkeyStepUpOptions(c,stolen,deps));
 assert.deepEqual(await run(c=>verifyPasskeyStepUp(c,stolen,other.assert(so3),deps)),{status:"rejected"},"unknown authenticator");
 // Replaying a previously captured assertion fails (challenge consumed / counter).
 assert.deepEqual(await run(c=>verifyPasskeyStepUp(c,stolen,auth.assert(so2,{keepCounter:true}),deps)),{status:"rejected"},"replayed assertion");
 // Using the owner's challenge from another session is rejected (challenge bound to session).
 const so4=await run(c=>passkeyStepUpOptions(c,s.session,deps));
 assert.deepEqual(await run(c=>verifyPasskeyStepUp(c,stolen,auth.assert(so4),deps)),{status:"rejected"},"cross-session challenge");

 // Step-up expires.
 await run(c=>c.query("UPDATE auth_sessions SET step_up_at=now()-interval '11 minutes' WHERE id=$1",[s.session.sessionId]));
 await assert.rejects(run(c=>authorizeStaffRequest(c,s.session,"roles.manage")),/authorization required/,"stale step-up");
});

test("first factor needs a fresh session; adding more needs step-up",async()=>{
 const old=await staffSession("editor",60*60_000);
 assert.equal(await run(c=>mayEnroll(c,old.session,{})),false);
 await assert.rejects(run(c=>passkeyRegistrationOptions(c,old.session,deps)),/authorization required/);
 assert.equal(await run(c=>beginTotpEnrollment(c,old.session,deps)),null);
});

test("TOTP: enrollment, replay rejection, lockout, recovery codes, factor removal rules",async()=>{
 const s=await staffSession("support");
 const {secret,uri}=await run(c=>beginTotpEnrollment(c,s.session,deps));
 assert.match(uri,/^otpauth:\/\/totp\/Justice%20For%20All:account-/);
 assert.deepEqual(await run(c=>confirmTotpEnrollment(c,s.session,"000000",deps)),{status:"rejected"});
 const step=currentStep();
 const conf=await run(c=>confirmTotpEnrollment(c,s.session,totpAt(secret,step),deps));
 assert.equal(conf.status,"active");assert.equal(conf.recoveryCodes.length,10);
 assert.equal(await run(c=>hasMfa(c,s.id)),true);
 assert.deepEqual(await run(c=>stepUpWithTotp(c,s.session,totpAt(secret,step),deps)),{status:"rejected"},"same time step cannot be reused");
 assert.deepEqual(await run(c=>stepUpWithTotp(c,s.session,totpAt(secret,step+1),deps)),{status:"stepped_up"});
 assert.deepEqual(await run(c=>stepUpWithTotp(c,s.session,totpAt(secret,step+1),deps)),{status:"rejected"},"replay");
 const stored=await run(c=>c.query("SELECT position(convert_to($2,'UTF8') IN secret_sealed)>0 AS leak FROM totp_factors WHERE identity_id=$1",[s.id,secret]));
 assert.equal(stored.rows[0].leak,false,"secret sealed at rest");

 assert.equal((await run(c=>revokeFactor(c,s.session,"totp",null,{}))).status,"last_staff_factor","staff keep at least one factor");

 // Recovery codes are single use.
 const code=conf.recoveryCodes[0];
 assert.equal((await run(c=>stepUpWithRecoveryCode(c,s.session,code,deps))).status,"stepped_up");
 assert.equal((await run(c=>stepUpWithRecoveryCode(c,s.session,code,deps))).status,"rejected");
 // Lockout after repeated failures, even for a correct code.
 for(let i=0;i<5;i++)await run(c=>stepUpWithTotp(c,s.session,"123456",deps));
 assert.deepEqual(await run(c=>stepUpWithTotp(c,s.session,totpAt(secret,step+1),deps)),{status:"locked"});
 assert.equal((await run(c=>stepUpWithRecoveryCode(c,s.session,conf.recoveryCodes[1],deps))).status,"locked","recovery codes cannot bypass lockout");
});
