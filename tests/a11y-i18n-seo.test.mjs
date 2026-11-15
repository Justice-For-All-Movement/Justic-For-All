import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {checkHtmlAccessibility} from "../scripts/lib/a11y-static.mjs";
import {MESSAGES,SUPPORTED_LOCALES,DEFAULT_LOCALE,LOCALE_META,resolveLocale,t} from "../packages/core/src/i18n.ts";

const good=`<!DOCTYPE html><html lang="en"><head><title>Ok</title></head><body><a href="#main">Skip</a>
<main id="main"><h1>Title</h1><img src="x.png" alt=""><label for="q">Search</label><input id="q" name="q">
<a href="/x">Named</a><button type="submit">Go</button></main></body></html>`;

test("static a11y checker passes a well-formed page",()=>{
 assert.deepEqual(checkHtmlAccessibility(good),[]);
});

test("static a11y checker flags common regressions",()=>{
 const cases=[
  [good.replace('lang="en"',''),/lang/],
  [good.replace("<title>Ok</title>",""),/title/],
  [good.replace("<h1>Title</h1>","<h1>A</h1><h1>B</h1>"),/exactly one <h1>/],
  [good.replace('<a href="#main">Skip</a>',""),/skip link/],
  [good.replace('alt=""',""),/img without alt/],
  [good.replace('<label for="q">Search</label>',""),/form field without label: q/],
  [good.replace('>Named<','><'),/link without accessible name/],
  [good.replace('<a href="/x">','<a href="/x" tabindex="2">'),/positive tabindex/],
  [good.replace('<button type="submit">Go</button>','<button type="submit"></button>'),/button without accessible name/],
  [good.replace('<h1>Title</h1>','<h1 id="main">Title</h1>'),/duplicate id/],
 ];
 for(const [html,pattern] of cases)assert.ok(checkHtmlAccessibility(html).some(p=>pattern.test(p)),String(pattern));
});

test("every locale has a complete message catalog and metadata",()=>{
 const keys=Object.keys(MESSAGES[DEFAULT_LOCALE]);
 for(const locale of SUPPORTED_LOCALES){
  assert.deepEqual(Object.keys(MESSAGES[locale]).sort(),[...keys].sort(),locale);
  for(const k of keys)assert.ok(MESSAGES[locale][k].trim().length>0);
  assert.ok(["ltr","rtl"].includes(LOCALE_META[locale].dir));
 }
 assert.equal(resolveLocale("xx"),"en");
 assert.equal(resolveLocale({}),"en");
 assert.equal(t("en","a11y.skipToContent"),"Skip to content");
});

test("content schema already supports additional locales without migration",()=>{
 const sql=readFileSync("db/migrations/0001_core.sql","utf8");
 assert.match(sql,/locale text NOT NULL DEFAULT 'en'/);
 assert.match(sql,/UNIQUE\(slug,locale\)/);
});

test("robots and sitemap exclude non-public and noindex surfaces",()=>{
 const site=readFileSync("apps/web/lib/site-url.ts","utf8");
 for(const p of ["/search","/design-system","/api/","/health","/ready"])assert.ok(site.includes(`"${p}"`),p);
 const sitemap=readFileSync("apps/web/app/sitemap.ts","utf8");
 assert.match(sitemap,/NOINDEX_PATHS/);
 assert.match(sitemap,/if \(!site\) return \[\]/);
 const search=readFileSync("packages/db/src/public-search.ts","utf8");
 assert.match(search,/SELECT slug, published_at FROM core_public_search/);
 const layout=readFileSync("apps/web/app/layout.tsx","utf8");
 assert.match(layout,/lang=\{LOCALE_META\[locale\]\.htmlLang\}/);
 assert.match(layout,/metadataBase/);
});

test("CI runs the static accessibility check after the build",()=>{
 const ci=readFileSync(".github/workflows/ci.yml","utf8");
 assert.ok(ci.indexOf("pnpm build")<ci.indexOf("pnpm check:a11y"));
});
