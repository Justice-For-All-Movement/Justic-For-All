import assert from "node:assert/strict";
import {randomBytes,randomUUID} from "node:crypto";
import test from "node:test";
import pg from "pg";
import {createMemoryEmailSender} from "../../adapters/src/email.ts";
import {parseKey} from "../../security/src/crypto.ts";
import {requestSignInLink,consumeSignInLink} from "../src/identity.ts";
import {recordConsent} from "../src/consent.ts";
import {startSubscription,confirmSubscription,unsubscribeByToken,subscriptionStatus,queueCampaign,deliverNotifications,suppressAddress} from "../src/subscriptions.ts";

const pool=new pg.Pool({host:process.env.PGHOST??"localhost",user:process.env.PGUSER??"jfa_ci",database:process.env.PGDATABASE??"jfa_ci",password:process.env.PGPASSWORD,max:4});
const run=async fn=>{const c=await pool.connect();try{return await fn(c);}finally{c.release();}};
test.after(()=>pool.end());
const keys={lookupKey:parseKey(randomBytes(32).toString("base64")),sealKey:parseKey(randomBytes(32).toString("base64"))};
const linkToken=(m,path)=>{const u=new URL(m.text.match(/https?:\/\/\S+/g).find(x=>x.includes(path)));return u.searchParams.get("token");};

async function account(sender){
 const deps={...keys,sender,publicOrigin:"https://jfa.example.org"};
 const email=`synthetic.${randomUUID().slice(0,8)}@example.org`;
 await run(c=>requestSignInLink(c,{email,clientKey:randomUUID()},deps));
 const s=await run(c=>consumeSignInLink(c,linkToken(sender.outbox.at(-1),"/auth/verify"),deps));
 return {id:s.identityId,email,deps};
}

test("double opt-in: consent, confirmation email, then active; nothing sent before",async()=>{
 const sender=createMemoryEmailSender();
 const me=await account(sender);
 const editor=(await run(c=>c.query("INSERT INTO identities DEFAULT VALUES RETURNING id"))).rows[0].id;
 await run(c=>c.query("INSERT INTO role_grants(subject_id,role,resource_scope) VALUES($1,'editor','core')",[editor]));

 assert.deepEqual(await run(c=>startSubscription(c,me.id,me.id,me.deps)),{status:"consent_required"});
 await run(c=>recordConsent(c,me.id,me.id,"news_email","grant"));
 assert.deepEqual(await run(c=>startSubscription(c,me.id,me.id,me.deps)),{status:"pending"});
 const confirmMail=sender.outbox.at(-1);
 assert.equal(confirmMail.category,"subscription_confirmation");
 assert.equal(await run(c=>subscriptionStatus(c,me.id)),"pending");

 // A campaign before confirmation reaches nobody unconfirmed.
 const before=await run(c=>queueCampaign(c,editor,{subject:"Synthetic update one",body:"Synthetic editorial news text for testing only."}));
 const mine=await run(c=>c.query("SELECT count(*)::int AS n FROM notification_deliveries n JOIN subscriptions s ON s.id=n.subscription_id JOIN contact_points p ON p.id=s.contact_point_id WHERE n.campaign_id=$1 AND p.identity_id=$2",[before.campaignId,me.id]));
 assert.equal(mine.rows[0].n,0,"unconfirmed address not queued");

 assert.deepEqual(await run(c=>confirmSubscription(c,linkToken(confirmMail,"/subscriptions/confirm"))),{status:"active"});
 assert.deepEqual(await run(c=>confirmSubscription(c,linkToken(confirmMail,"/subscriptions/confirm"))),{status:"invalid_or_expired"},"single use");
 assert.equal(await run(c=>subscriptionStatus(c,me.id)),"active");

 await assert.rejects(run(c=>queueCampaign(c,me.id,{subject:"Not allowed",body:"Subscribers cannot send campaigns to anyone."})),/authorization required/);
 const campaign=await run(c=>queueCampaign(c,editor,{subject:"Synthetic update two",body:"Synthetic editorial news text for testing only."}));
 const sentBefore=sender.outbox.length;
 let r;do{r=await run(c=>deliverNotifications(c,me.deps,200));}while(r.sent+r.skipped+r.retried+r.dead>0);
 const mail=sender.outbox.slice(sentBefore).find(m=>m.to===me.email);
 assert.ok(mail,"active subscriber receives campaign");
 assert.match(mail.text,/Unsubscribe instantly: https:\/\/jfa\.example\.org\/subscriptions\/unsubscribe\?token=/);
 assert.match(mail.headers["List-Unsubscribe"],/subscriptions\/unsubscribe\/submit\?token=/);
 assert.equal(mail.headers["List-Unsubscribe-Post"],"List-Unsubscribe=One-Click");
 assert.equal(mail.idempotencyKey.startsWith("delivery-"),true);
 // Redelivery is idempotent: the same campaign is never queued twice for one subscription.
 await assert.rejects(run(c=>c.query("INSERT INTO notification_deliveries(campaign_id,subscription_id) SELECT campaign_id,subscription_id FROM notification_deliveries WHERE campaign_id=$1 LIMIT 1",[campaign.campaignId])),/duplicate key/);

 // One-click unsubscribe stops future mail and suppresses the address.
 await run(c=>unsubscribeByToken(c,linkToken(mail,"/subscriptions/unsubscribe")));
 assert.equal(await run(c=>subscriptionStatus(c,me.id)),"none");
 const next=await run(c=>queueCampaign(c,editor,{subject:"Synthetic update three",body:"Synthetic editorial news text for testing only."}));
 const q=await run(c=>c.query("SELECT count(*)::int AS n FROM notification_deliveries n JOIN subscriptions s ON s.id=n.subscription_id JOIN contact_points p ON p.id=s.contact_point_id WHERE n.campaign_id=$1 AND p.identity_id=$2",[next.campaignId,me.id]));
 assert.equal(q.rows[0].n,0,"unsubscribed address not queued");
 const sup=await run(c=>c.query("SELECT reason FROM email_suppressions s JOIN contact_points p ON p.lookup_hmac=s.lookup_hmac WHERE p.identity_id=$1",[me.id]));
 assert.equal(sup.rows[0].reason,"unsubscribed");
});

test("consent withdrawal and suppression are re-checked at send time",async()=>{
 const sender=createMemoryEmailSender();
 const me=await account(sender);
 const admin=(await run(c=>c.query("INSERT INTO identities DEFAULT VALUES RETURNING id"))).rows[0].id;
 await run(c=>c.query("INSERT INTO role_grants(subject_id,role,resource_scope) VALUES($1,'admin','core')",[admin]));
 await run(c=>recordConsent(c,me.id,me.id,"news_email","grant"));
 await run(c=>startSubscription(c,me.id,me.id,me.deps));
 await run(c=>confirmSubscription(c,linkToken(sender.outbox.at(-1),"/subscriptions/confirm")));
 const camp=await run(c=>queueCampaign(c,admin,{subject:"Synthetic queued item",body:"Synthetic editorial news text for testing only."}));
 // Withdraw consent after queueing: delivery must be skipped, not sent.
 await run(c=>recordConsent(c,me.id,me.id,"news_email","withdraw"));
 assert.equal(await run(c=>subscriptionStatus(c,me.id)),"none","withdrawal unsubscribes");
 const before=sender.outbox.length;
 let r;do{r=await run(c=>deliverNotifications(c,me.deps,200));}while(r.sent+r.skipped+r.retried+r.dead>0);
 assert.ok(!sender.outbox.slice(before).some(m=>m.to===me.email),"no mail after withdrawal");
 const st=await run(c=>c.query("SELECT n.state,n.last_error FROM notification_deliveries n JOIN subscriptions s ON s.id=n.subscription_id JOIN contact_points p ON p.id=s.contact_point_id WHERE n.campaign_id=$1 AND p.identity_id=$2",[camp.campaignId,me.id]));
 assert.deepEqual(st.rows[0],{state:"skipped",last_error:"not_eligible"});

 // Bounce suppression requires privacy.process and blocks even a re-confirmed subscription.
 const lookup=(await run(c=>c.query("SELECT lookup_hmac FROM contact_points WHERE identity_id=$1",[me.id]))).rows[0].lookup_hmac;
 await assert.rejects(run(c=>suppressAddress(c,me.id,lookup,"bounced")),/authorization required/);
 await run(c=>suppressAddress(c,admin,lookup,"bounced"));
 await run(c=>recordConsent(c,me.id,me.id,"news_email","grant"));
 await run(c=>startSubscription(c,me.id,me.id,me.deps));
 await run(c=>confirmSubscription(c,linkToken(sender.outbox.at(-1),"/subscriptions/confirm")));
 const camp2=await run(c=>queueCampaign(c,admin,{subject:"Synthetic after bounce",body:"Synthetic editorial news text for testing only."}));
 const q=await run(c=>c.query("SELECT count(*)::int AS n FROM notification_deliveries n JOIN subscriptions s ON s.id=n.subscription_id JOIN contact_points p ON p.id=s.contact_point_id WHERE n.campaign_id=$1 AND p.identity_id=$2",[camp2.campaignId,me.id]));
 assert.equal(q.rows[0].n,0,"bounced address stays suppressed");
});

test("failed sends retry with backoff, then dead-letter; campaign text is plain and bounded",async()=>{
 const admin=(await run(c=>c.query("INSERT INTO identities DEFAULT VALUES RETURNING id"))).rows[0].id;
 await run(c=>c.query("INSERT INTO role_grants(subject_id,role,resource_scope) VALUES($1,'admin','core')",[admin]));
 await assert.rejects(run(c=>queueCampaign(c,admin,{subject:"<b>bold</b> subject",body:"Synthetic editorial news text for testing only."})),/check constraint/);
 await assert.rejects(run(c=>queueCampaign(c,admin,{subject:"Header\r\nBcc: x@y.z",body:"Synthetic editorial news text for testing only."})),/check constraint/);
 const okSender=createMemoryEmailSender();
 const me=await account(okSender);
 await run(c=>recordConsent(c,me.id,me.id,"news_email","grant"));
 await run(c=>startSubscription(c,me.id,me.id,me.deps));
 await run(c=>confirmSubscription(c,linkToken(okSender.outbox.at(-1),"/subscriptions/confirm")));
 const camp=await run(c=>queueCampaign(c,admin,{subject:"Synthetic retry test",body:"Synthetic editorial news text for testing only."}));
 const failing={...me.deps,sender:{id:"memory",available:true,async send(){return {status:"failed",retryable:true,reason:"http_503"};}}};
 let r;do{r=await run(c=>deliverNotifications(c,failing,200));}while(r.sent+r.skipped+r.retried+r.dead>0);
 const row=async()=> (await run(c=>c.query("SELECT n.id,n.state,n.attempts,n.next_attempt_at>now() AS later FROM notification_deliveries n JOIN subscriptions s ON s.id=n.subscription_id JOIN contact_points p ON p.id=s.contact_point_id WHERE n.campaign_id=$1 AND p.identity_id=$2",[camp.campaignId,me.id]))).rows[0];
 const first=await row();
 assert.deepEqual({state:first.state,attempts:first.attempts,later:first.later},{state:"failed",attempts:1,later:true});
 await run(c=>c.query("UPDATE notification_deliveries SET attempts=5,next_attempt_at=NULL WHERE id=$1",[first.id]));
 do{r=await run(c=>deliverNotifications(c,failing,200));}while(r.sent+r.skipped+r.retried+r.dead>0);
 assert.equal((await row()).state,"dead");
});
