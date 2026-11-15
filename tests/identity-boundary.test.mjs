import test from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {readFileSync} from "node:fs";
import {randomBytes} from "node:crypto";
import {newBearerToken,tokenDigest,isWellFormedToken,parseKey,lookupHmac,sealText,openText,normalizeEmail} from "../packages/security/src/crypto.ts";
import {createResendEmailSender,emailSenderFromEnv,disabledEmailSender,createLogEmailSender} from "../packages/adapters/src/email.ts";
import {checkRuntimeEnv} from "../scripts/lib/runtime-env.mjs";

const k=()=>parseKey(randomBytes(32).toString("base64"));

test("bearer tokens are high-entropy and only digests are comparable",()=>{
 const a=newBearerToken(),b=newBearerToken();
 assert.notEqual(a,b);assert.ok(isWellFormedToken(a));
 assert.equal(tokenDigest(a).length,32);
 for(const bad of ["",a+"x","../"+a.slice(3),null,42])assert.equal(isWellFormedToken(bad),false);
});

test("sealed values are authenticated and bound to their context",()=>{
 const key=k();
 const sealed=sealText(key,"person@example.org","contact:1");
 assert.ok(!sealed.toString("latin1").includes("example.org"));
 assert.equal(openText(key,sealed,"contact:1"),"person@example.org");
 assert.throws(()=>openText(key,sealed,"contact:2"),"AAD mismatch must fail");
 const tampered=Buffer.from(sealed);tampered[tampered.length-1]^=1;
 assert.throws(()=>openText(key,tampered,"contact:1"));
 assert.throws(()=>openText(k(),sealed,"contact:1"));
 assert.notEqual(sealText(key,"x","a").toString("hex"),sealText(key,"x","a").toString("hex"),"random nonce");
});

test("keyed lookup is deterministic per key and keys must be 32 bytes",()=>{
 const key=k();
 assert.deepEqual(lookupHmac(key,"a"),lookupHmac(key,"a"));
 assert.notDeepEqual(lookupHmac(key,"a"),lookupHmac(k(),"a"));
 assert.equal(parseKey("short"),null);assert.equal(parseKey(undefined),null);
 assert.match(key.id,/^k_[0-9a-f]{12}$/);
});

test("email normalization accepts plain addresses only",()=>{
 assert.equal(normalizeEmail("  Person@Example.ORG "),"person@example.org");
 for(const bad of ["a@b","no-at.example.org","a@b@c.org","x@exa mple.org","x@example.org\r\nBcc: y@z.org",`${"a".repeat(250)}@x.org`,null])
  assert.equal(normalizeEmail(bad),null,String(bad));
});

test("email provider selection fails closed and dev adapters are refused in production",()=>{
 assert.equal(emailSenderFromEnv({}).id,"disabled");
 assert.equal(emailSenderFromEnv({EMAIL_PROVIDER:"memory",NODE_ENV:"production"}).available,false);
 assert.equal(emailSenderFromEnv({EMAIL_PROVIDER:"log",NODE_ENV:"production"}).available,false);
 assert.equal(emailSenderFromEnv({EMAIL_PROVIDER:"resend"}).id,"disabled","missing key/from");
 assert.equal(emailSenderFromEnv({EMAIL_PROVIDER:"resend",EMAIL_PROVIDER_API_KEY:"re_123456789",EMAIL_FROM_ADDRESS:"bad\r\nBcc:x@y.z"}).id,"disabled");
 assert.equal(emailSenderFromEnv({EMAIL_PROVIDER:"resend",EMAIL_PROVIDER_API_KEY:"re_123456789",EMAIL_FROM_ADDRESS:"JFA <no-reply@example.org>"}).id,"resend");
 assert.equal(emailSenderFromEnv({EMAIL_PROVIDER:"memory"}).id,"memory");
 const lines=[];const log=createLogEmailSender(l=>lines.push(l));
 return log.send({to:"a@example.org",subject:"s",text:"t",category:"notification",idempotencyKey:"i"}).then(r=>{assert.equal(r.status,"sent");assert.equal(lines.length,1);});
});

test("disabled sender never reports success",async()=>{
 assert.deepEqual(await disabledEmailSender.send({to:"a@example.org",subject:"s",text:"t",category:"notification",idempotencyKey:"x"}),{status:"failed",retryable:false,reason:"email_disabled"});
});

test("Resend adapter contract: request shape, success, retryable and permanent failures",async()=>{
 const seen=[];let mode="ok";
 const server=createServer((req,res)=>{let body="";req.on("data",c=>body+=c);req.on("end",()=>{
  seen.push({method:req.method,url:req.url,auth:req.headers.authorization,idem:req.headers["idempotency-key"],type:req.headers["content-type"],body:JSON.parse(body)});
  if(mode==="ok"){res.writeHead(200,{"content-type":"application/json"});res.end(JSON.stringify({id:"msg_123"}));}
  else if(mode==="429"){res.writeHead(429);res.end("{}");}
  else if(mode==="422"){res.writeHead(422);res.end("{}");}
  else{res.writeHead(200);res.end("not json");}
 });});
 await new Promise(r=>server.listen(0,"127.0.0.1",r));
 try{
  const sender=createResendEmailSender({apiKey:"re_test_key",from:"JFA <no-reply@example.org>",baseUrl:`http://127.0.0.1:${server.address().port}`});
  const msg={to:"person@example.org",subject:"Your sign-in link",text:"body",category:"sign_in_link",idempotencyKey:"sign-in-abc"};
  assert.deepEqual(await sender.send(msg),{status:"sent",providerMessageId:"msg_123"});
  assert.deepEqual(seen[0],{method:"POST",url:"/emails",auth:"Bearer re_test_key",idem:"sign-in-abc",type:"application/json",
   body:{from:"JFA <no-reply@example.org>",to:["person@example.org"],subject:"Your sign-in link",text:"body"}});
  mode="429";assert.deepEqual(await sender.send(msg),{status:"failed",retryable:true,reason:"http_429"});
  mode="422";assert.deepEqual(await sender.send(msg),{status:"failed",retryable:false,reason:"http_422"});
  mode="bad";assert.deepEqual(await sender.send(msg),{status:"failed",retryable:true,reason:"malformed_response"});
  const offline=createResendEmailSender({apiKey:"k",from:"a@b.org",baseUrl:"http://127.0.0.1:1",timeoutMs:500});
  assert.deepEqual(await offline.send(msg),{status:"failed",retryable:true,reason:"network_error"});
 }finally{server.close();}
});

test("runtime env registry covers identity and email configuration",()=>{
 const base={NODE_ENV:"production",DATABASE_URL:"postgresql://a:b@h.neon.tech/d?sslmode=require",APP_PUBLIC_URL:"https://jfa.example.org"};
 const key=randomBytes(32).toString("base64");
 assert.equal(checkRuntimeEnv({...base,IDENTITY_LOOKUP_KEY:key,CONTACT_ENCRYPTION_KEY:key}).ok,false,"keys must differ");
 assert.equal(checkRuntimeEnv({...base,IDENTITY_LOOKUP_KEY:"short"}).ok,false);
 assert.equal(checkRuntimeEnv({...base,EMAIL_PROVIDER:"log"}).ok,false,"log adapter refused in production");
 assert.equal(checkRuntimeEnv({...base,EMAIL_PROVIDER:"resend"}).ok,false);
 assert.equal(checkRuntimeEnv({...base,EMAIL_PROVIDER:"resend",EMAIL_PROVIDER_API_KEY:"re_123456789",EMAIL_FROM_ADDRESS:"JFA <no-reply@example.org>",
  IDENTITY_LOOKUP_KEY:key,CONTACT_ENCRYPTION_KEY:randomBytes(32).toString("base64")}).ok,true);
});

test("web auth layer: CSRF origin checks, __Host- cookie, POST-only token consumption",()=>{
 const auth=readFileSync("apps/web/lib/auth.ts","utf8");
 assert.match(auth,/__Host-jfa_session/);
 assert.match(auth,/httpOnly: true, secure: env\.NODE_ENV === "production", sameSite: "lax"/);
 assert.match(auth,/sec-fetch-site/);
 for(const f of ["apps/web/app/auth/sign-in/route.ts","apps/web/app/auth/verify/confirm/route.ts","apps/web/app/auth/sign-out/route.ts","apps/web/lib/account-action.ts"])
  assert.match(readFileSync(f,"utf8"),/isSameOriginPost\(request\)/,f);
 const verify=readFileSync("apps/web/app/auth/verify/page.tsx","utf8");
 assert.match(verify,/method="post"/);assert.doesNotMatch(verify,/consumeSignInLink/);
 assert.match(readFileSync("apps/web/next.config.mjs","utf8"),/source: "\/auth\/:path\*", headers: \[\{ key: "Referrer-Policy", value: "no-referrer" \}/);
 for(const f of ["deactivate","delete"])assert.match(readFileSync(`apps/web/app/account/${f}/route.ts`,"utf8"),/confirm: "/);
});
