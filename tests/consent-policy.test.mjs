import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {CONSENT_PURPOSES,summarizeConsent,hasConsent,findPurpose} from "../packages/core/src/consent.ts";

const at=s=>new Date(`2026-11-${s}T00:00:00Z`);
const purpose=CONSENT_PURPOSES[0];

test("no event means no consent; latest event wins; withdrawal stops processing",()=>{
 assert.equal(hasConsent([],purpose.id),false);
 const granted=[{purpose:purpose.id,policyVersion:purpose.version,decision:"grant",recordedAt:at(15)}];
 assert.equal(hasConsent(granted,purpose.id),true);
 const withdrawn=[...granted,{purpose:purpose.id,policyVersion:purpose.version,decision:"withdraw",recordedAt:at(16)}];
 assert.equal(hasConsent(withdrawn,purpose.id),false);
 assert.equal(summarizeConsent(withdrawn).find(s=>s.purpose===purpose.id).status,"withdrawn");
});

test("consent for one purpose never authorizes another",()=>{
 const events=[{purpose:"news_email",policyVersion:findPurpose("news_email").version,decision:"grant",recordedAt:at(15)}];
 assert.equal(hasConsent(events,"news_email"),true);
 for(const p of CONSENT_PURPOSES.filter(p=>p.id!=="news_email"))assert.equal(hasConsent(events,p.id),false,p.id);
 assert.equal(hasConsent(events,"unknown_purpose"),false);
});

test("grants for an outdated policy version require re-consent",()=>{
 const events=[{purpose:purpose.id,policyVersion:"2020-01-01",decision:"grant",recordedAt:at(15)}];
 assert.equal(summarizeConsent(events).find(s=>s.purpose===purpose.id).status,"reconsent_required");
 assert.equal(hasConsent(events,purpose.id),false);
});

test("purposes are well-formed and versioned",()=>{
 const ids=new Set();
 for(const p of CONSENT_PURPOSES){
  assert.match(p.id,/^[a-z][a-z0-9_]{2,60}$/);assert.ok(!ids.has(p.id));ids.add(p.id);
  assert.match(p.version,/^\d{4}-\d{2}-\d{2}$/);assert.ok(p.reconsentFrom<=p.version);
  assert.ok(p.description.length>30);
 }
 assert.equal(findPurpose("constructor"),undefined);
});

test("consent routes are self-service, same-origin and keep the session",()=>{
 const route=readFileSync("apps/web/app/account/consent/route.ts","utf8");
 assert.match(route,/recordConsent\(client, session\.identityId, session\.identityId/);
 assert.match(route,/keepSession: true/);
 const exp=readFileSync("apps/web/app/account/consent/export/route.ts","utf8");
 assert.match(exp,/exportConsent\(client, session\.identityId, session\.identityId\)/);
 assert.match(exp,/"Cache-Control": "no-store"/);
});

test("equal timestamps resolve to the later ledger entry",()=>{
 const t=at(15);
 const events=[{purpose:purpose.id,policyVersion:purpose.version,decision:"grant",recordedAt:t},{purpose:purpose.id,policyVersion:purpose.version,decision:"withdraw",recordedAt:t}];
 assert.equal(hasConsent(events,purpose.id),false);
 assert.equal(hasConsent([...events].reverse(),purpose.id),true);
});
