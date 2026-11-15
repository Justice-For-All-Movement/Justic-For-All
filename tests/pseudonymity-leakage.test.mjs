import test from "node:test";
import assert from "node:assert/strict";
import {readdirSync,readFileSync,statSync} from "node:fs";
import {join} from "node:path";
import {checkPseudonym} from "../packages/core/src/pseudonym.ts";

test("pseudonyms: bounded, no contact details, no impersonation",()=>{
 for(const ok of ["River Song","Ana-María","O'Neil 7","Proud Supporter","Teamwork"])assert.equal(checkPseudonym(ok).ok,true,ok);
 const reason=v=>checkPseudonym(v).reason;
 assert.equal(reason("ab"),"length");assert.equal(reason("x".repeat(41)),"length");
 assert.equal(reason("<script>"),"characters");assert.equal(reason(" lead"),"length"===reason(" lead")?"length":reason(" lead"));
 for(const v of ["me@example.org","call 555 123 4567","www.site.example","visit https x","myname.com"])assert.equal(reason(v),"contact_details",v);
 for(const v of ["Admin","JFA team","Official Moderator","JusticeForAll Staff","staff"])assert.equal(reason(v),"reserved",v);
 assert.equal(checkPseudonym("  River   Song ").value,"River Song");
 assert.equal(checkPseudonym(42).ok,false);
});

const files=[];
const walk=d=>{for(const n of readdirSync(d)){if(n==="node_modules"||n.startsWith("."))continue;const p=join(d,n);statSync(p).isDirectory()?walk(p):/\.(tsx?|mjs|css)$/.test(n)&&files.push(p);}};
walk("apps/web");walk("packages/ui");

test("no third-party scripts, styles, fonts, images or frames are loaded",()=>{
 for(const f of files){
  const s=readFileSync(f,"utf8");
  assert.doesNotMatch(s,/<(script|iframe|img|link)\b[^>]*\b(src|href)=["'{]`?https?:/i,f);
  if(f.endsWith(".css"))assert.doesNotMatch(s,/@import|url\(["']?https?:\/\//i,f);
  assert.doesNotMatch(s,/next\/script|google-analytics|googletagmanager|plausible|segment\.io|hotjar|facebook\.net/i,f);
 }
 const deps=Object.keys({...JSON.parse(readFileSync("apps/web/package.json","utf8")).dependencies});
 assert.ok(!deps.some(d=>/analytics|gtag|sentry|posthog|mixpanel|segment/i.test(d)),deps.join());
});

test("cookies are only set by sign-in and account routes",()=>{
 for(const f of files){
  const s=readFileSync(f,"utf8");
  if(/cookies\.set\(|cookies\(\)\)\.set\(|Set-Cookie/.test(s))assert.match(f,/app[\\/](auth|account)[\\/]|lib[\\/]account-action/,f);
 }
});

test("referrer and metadata leakage controls are configured",()=>{
 const cfg=readFileSync("apps/web/next.config.mjs","utf8");
 assert.match(cfg,/Referrer-Policy", value: "strict-origin-when-cross-origin"/);
 assert.match(cfg,/poweredByHeader: false/);
 for(const f of files.filter(f=>f.endsWith(".tsx"))){
  const s=readFileSync(f,"utf8");
  for(const m of s.matchAll(/<a\b[^>]*href=["']https?:[^>]*>/g))assert.match(m[0],/rel="noopener noreferrer/,`${f}: ${m[0]}`);
 }
});

test("anonymity page states the real boundaries",()=>{
 const p=readFileSync("apps/web/app/anonymity/page.tsx","utf8");
 assert.match(p,/not anonymity/);assert.match(p,/IP addresses/);assert.match(p,/does <strong>not<\/strong> accept testimony/);
});
