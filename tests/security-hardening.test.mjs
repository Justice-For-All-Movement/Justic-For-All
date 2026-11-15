import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {rateLimit} from "../apps/web/lib/rate-limit.ts";

test("sliding-window limiter allows the limit, blocks the excess, and recovers",()=>{
 const key="test:"+Math.random(),t0=1_000_000;
 for(let i=0;i<5;i++)assert.equal(rateLimit(key,5,60_000,t0+i).allowed,true);
 const blocked=rateLimit(key,5,60_000,t0+10);
 assert.equal(blocked.allowed,false);assert.ok(blocked.retryAfterSeconds>=1&&blocked.retryAfterSeconds<=60);
 assert.equal(rateLimit(key,5,60_000,t0+60_001).allowed,true,"window slides");
 assert.equal(rateLimit("other:"+Math.random(),5,60_000,t0+10).allowed,true,"keys are independent");
});

test("security headers: CSP without third-party origins, framing denied, HSTS in production",async()=>{
 process.env.NODE_ENV="production";
 const {default:cfg}=await import("../apps/web/next.config.mjs?prod="+Date.now());
 const rules=await cfg.headers();
 const all=Object.fromEntries(rules.find(r=>r.source==="/:path*").headers.map(h=>[h.key,h.value]));
 const csp=all["Content-Security-Policy"];
 for(const d of ["default-src 'self'","object-src 'none'","frame-ancestors 'none'","base-uri 'self'","form-action 'self'","upgrade-insecure-requests"])assert.ok(csp.includes(d),d);
 assert.doesNotMatch(csp,/https?:|\*|unsafe-eval/,"no remote origins, wildcards or eval in production");
 assert.equal(all["X-Frame-Options"],"DENY");
 assert.match(all["Strict-Transport-Security"],/max-age=31536000/);
 assert.equal(all["Cross-Origin-Opener-Policy"],"same-origin");
 assert.equal(cfg.poweredByHeader,false);
});

test("public endpoints are rate limited and size bounded",()=>{
 assert.match(readFileSync("apps/web/app/api/v1/search/route.ts","utf8"),/rateLimit\(`search:/);
 const signIn=readFileSync("apps/web/app/auth/sign-in/route.ts","utf8");
 assert.match(signIn,/rateLimit\(`sign-in:/);assert.match(signIn,/content-length/);
 const events=readFileSync("apps/web/app/api/internal/v1/events/[source]/route.ts","utf8");
 assert.match(events,/rateLimit\(`events:/);assert.match(events,/MAX_EVENT_BYTES/);
});

test("ASVS control map exists and does not claim certification",()=>{
 const doc=readFileSync("docs/SECURITY_ASVS_MAP.md","utf8");
 for(const v of ["V2","V3","V4","V5","V7","V8","V9","V13","V14"])assert.ok(doc.includes(`| ${v}`),v);
 assert.match(doc,/not an ASVS certification/i);
});
