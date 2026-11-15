import test from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {randomBytes,randomUUID} from "node:crypto";
import {validateEnvelope,isSafePublicUrl} from "../packages/adapters/src/events.ts";
import {parseKeyRing,signWebhook,verifyWebhook,httpEventDeliverer} from "../packages/adapters/src/webhook.ts";
import {availabilityFrom,httpCapabilityAdapter,unconfiguredAdapter} from "../packages/adapters/src/sdk.ts";

const env=(o={})=>JSON.stringify({event_id:randomUUID(),event_type:"public_projection.published.v1",schema_version:"1.2.0",source_service:"foia-aggregator",
 source_resource_id:"rec-123",occurred_at:"2026-11-15T10:00:00Z",projection_version:"v3",classification:"PUBLIC_APPROVED",payload:{public_url:"/records/rec-123",title:"Synthetic record"},...o});

test("envelope validation: strict, allowlisted, versioned and public-only",()=>{
 assert.equal(validateEnvelope(env(),"foia-aggregator").ok,true);
 const code=(o,src="foia-aggregator")=>validateEnvelope(typeof o==="string"?o:env(o),src).code;
 assert.equal(code({event_type:"case.created.v1"}),"event_type_not_allowed");
 assert.equal(code({schema_version:"2.0.0"}),"incompatible_schema_version");
 assert.equal(code({}, "other-source"),"source_mismatch");
 assert.equal(code({classification:"RESTRICTED"}),"classification_not_public");
 assert.equal(code({payload:{public_url:"javascript:alert(1)",title:"x"}}),"unsafe_public_url");
 assert.equal(code({payload:{public_url:"/r",title:"x",private_name:"Jane"}}),"invalid_payload");
 assert.equal(code({payload:{public_url:"/r",title:"<b>x</b>"}}),"invalid_payload");
 assert.equal(code({event_id:"1"}),"invalid_event_id");
 assert.equal(code({extra:1}),"unexpected_fields");
 assert.equal(code("not json"),"malformed_json");
 assert.equal(code(env({payload:{public_url:"/r",title:"x".repeat(500)},source_resource_id:"a".repeat(120)}).padEnd(17000," ")),"payload_too_large");
 assert.equal(isSafePublicUrl("//evil.example/x"),false);
 assert.equal(isSafePublicUrl("https://user:pw@x.org"),false);
});

test("webhook signatures: forged, stale, future, wrong key/source rejected; rotation works",()=>{
 const k1=randomBytes(32),k2=randomBytes(32);
 const ring=parseKeyRing(JSON.stringify({"foia-aggregator":{"2026a":k1.toString("base64"),"2026b":k2.toString("base64")}}));
 const now=1_763_200_000,body=env();
 const h=(kid,key,ts=now,src="foia-aggregator",b=body)=>new Map(Object.entries({"x-jfa-source":src,"x-jfa-key-id":kid,"x-jfa-timestamp":String(ts),"x-jfa-signature":signWebhook(key,src,kid,ts,b)}));
 assert.deepEqual(verifyWebhook(ring,"foia-aggregator",h("2026a",k1),body,now),{ok:true,source:"foia-aggregator",keyId:"2026a"});
 assert.equal(verifyWebhook(ring,"foia-aggregator",h("2026b",k2),body,now).ok,true,"rotated key accepted");
 assert.equal(verifyWebhook(ring,"foia-aggregator",h("2026a",k2),body,now).code,"bad_signature","signed with wrong key");
 assert.equal(verifyWebhook(ring,"foia-aggregator",h("2026a",k1),body+" ",now).code,"bad_signature","body changed");
 assert.equal(verifyWebhook(ring,"foia-aggregator",h("2026a",k1,now-301),body,now).code,"stale","replayed old request");
 assert.equal(verifyWebhook(ring,"foia-aggregator",h("2026a",k1,now+31),body,now).code,"future");
 assert.equal(verifyWebhook(ring,"foia-aggregator",h("old",k1),body,now).code,"unknown_key");
 assert.equal(verifyWebhook(ring,"civic-registry",h("2026a",k1,now,"civic-registry"),body,now).code,"unknown_source");
 assert.equal(verifyWebhook(ring,"foia-aggregator",h("2026a",k1,now,"civic-registry"),body,now).code,"malformed_headers","header/path source mismatch");
 const sigOnly=h("2026a",k1);sigOnly.set("x-jfa-signature","v1="+"0".repeat(64));
 assert.equal(verifyWebhook(ring,"foia-aggregator",sigOnly,body,now).code,"bad_signature");
});

test("key ring parsing fails closed on any malformed entry",()=>{
 assert.equal(parseKeyRing(undefined).size,0);
 assert.equal(parseKeyRing("{bad").size,0);
 assert.equal(parseKeyRing(JSON.stringify({"src":{"k":randomBytes(16).toString("base64")}})).size,0,"short secret");
 assert.equal(parseKeyRing(JSON.stringify({"Bad Source":{"k":randomBytes(32).toString("base64")}})).size,0);
 assert.equal(parseKeyRing(JSON.stringify({"src":{"k":randomBytes(32).toString("base64")}})).size,1);
});

const serve=handler=>new Promise(r=>{const s=createServer(handler);s.listen(0,"127.0.0.1",()=>r(s));});
const reply=(res,status,body)=>{res.writeHead(status,{"content-type":"application/json"});res.end(typeof body==="string"?body:JSON.stringify(body));};

test("capability probe contract: verified, incompatible, unavailable, fail-closed availability",async()=>{
 let mode="ok";const seen=[];
 const s=await serve((req,res)=>{seen.push({url:req.url,auth:req.headers.authorization});
  if(mode==="ok")reply(res,200,{contract_version:"1.4.0",capabilities:[{name:"records.search",methods:["get"]}]});
  else if(mode==="v2")reply(res,200,{contract_version:"2.0.0",capabilities:[]});
  else if(mode==="bad")reply(res,200,{contract_version:"1.0.0",capabilities:[{name:"x; drop",methods:[]}]});
  else reply(res,500,{});});
 try{
  const a=httpCapabilityAdapter({id:"foia-aggregator",baseUrl:`http://127.0.0.1:${s.address().port}`,token:"server-side-token"});
  const p=await a.probe();
  assert.equal(p.status,"verified");assert.equal(seen[0].url,"/.well-known/jfa-capabilities");assert.equal(seen[0].auth,"Bearer server-side-token");
  assert.equal(availabilityFrom(p,new Date(),["records.search"]),"available");
  assert.equal(availabilityFrom(p,new Date(),["records.submit"]),"unavailable","missing capability");
  assert.equal(availabilityFrom(p,new Date(Date.now()+16*60_000),["records.search"]),"unavailable","stale probe");
  mode="v2";assert.equal((await a.probe()).status,"incompatible");
  mode="bad";assert.equal((await a.probe()).status,"incompatible");
  mode="500";assert.equal((await a.probe()).status,"unavailable");
 }finally{s.close();}
 assert.equal((await httpCapabilityAdapter({id:"x",baseUrl:"http://example.org"}).probe()).status,"unconfigured","plain http refused");
 assert.equal((await httpCapabilityAdapter({id:"x",baseUrl:"https://127.0.0.1:1",timeoutMs:300}).probe()).status,"unavailable");
 assert.equal(availabilityFrom(await unconfiguredAdapter("x").probe(),new Date()),"unavailable");
 assert.equal(availabilityFrom(null,new Date()),"unavailable");
});

test("outbound deliverer signs requests the receiver can verify; maps failures",async()=>{
 const secret=randomBytes(32);const ring=parseKeyRing(JSON.stringify({"justice-for-all-core":{"k1":secret.toString("base64")}}));
 let status=200;const results=[];
 const s=await serve((req,res)=>{let b="";req.on("data",c=>b+=c);req.on("end",()=>{
  results.push({verified:verifyWebhook(ring,"justice-for-all-core",{get:n=>req.headers[n]??null},b,Math.floor(Date.now()/1000)),idem:req.headers["idempotency-key"]});
  reply(res,status,{});});});
 try{
  const d=httpEventDeliverer({url:`http://127.0.0.1:${s.address().port}/hook`,keyId:"k1",secret});
  const m={eventId:randomUUID(),eventType:"cms.published",schemaVersion:"1",payload:{slug:"x"}};
  assert.deepEqual(await d(m),{ok:true});
  assert.equal(results[0].verified.ok,true);assert.equal(results[0].idem,m.eventId);
  status=503;assert.deepEqual(await d(m),{ok:false,retryable:true,code:"http_503"});
  status=400;assert.deepEqual(await d(m),{ok:false,retryable:false,code:"http_400"});
 }finally{s.close();}
});
