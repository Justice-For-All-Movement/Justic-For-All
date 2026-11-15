import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {parseSearchQuery,splitHighlight} from "../packages/db/src/public-search.ts";
import {buildSiteIndex,searchSitePages} from "../packages/core/src/site-search.ts";
import {participationPaths,publicResources} from "../packages/core/src/participation.ts";

test("search input is normalized and bounded",()=>{
 assert.deepEqual({...parseSearchQuery({q:"  public\u0000  records "})},{q:"public records",type:undefined,locale:"en",page:1});
 assert.equal(parseSearchQuery({q:"a"}),null);
 assert.equal(parseSearchQuery({q:"x".repeat(101)}),null);
 assert.equal(parseSearchQuery({q:"ok",type:"draft"}),null);
 assert.equal(parseSearchQuery({q:"ok",page:"21"}),null);
 assert.equal(parseSearchQuery({q:"ok",page:"0"}),null);
 assert.equal(parseSearchQuery({q:"ok",page:"1e3"}),null);
 assert.equal(parseSearchQuery({q:"ok",locale:"../en"}),null);
 assert.equal(parseSearchQuery({q:"ok",type:"faq",page:"3"}).page,3);
});

test("highlight splitting yields plain text parts only",()=>{
 assert.deepEqual(splitHighlight("a \u0002public\u0003 record \u0002x"),[
  {text:"a ",match:false},{text:"public",match:true},{text:" record ",match:false},{text:"x",match:true}]);
 assert.deepEqual(splitHighlight("<script>alert(1)</script>"),[{text:"<script>alert(1)</script>",match:false}]);
});

test("site page search requires every term and never indexes outside the catalog",()=>{
 const index=buildSiteIndex([{slug:"public-record",name:"The Public Record",description:"records requests",overview:"official responses"}],participationPaths,publicResources);
 const hits=searchSitePages(index,"record request");
 assert.ok(hits.some(h=>h.href==="/initiatives/public-record"));
 assert.deepEqual(searchSitePages(index,"zzzz nothing"),[]);
 assert.deepEqual(searchSitePages(index,"!"),[]);
 for(const page of index)assert.ok(page.href.startsWith("/"));
});

test("search UI and API render snippets as text and are not indexed",()=>{
 const page=readFileSync("apps/web/app/search/page.tsx","utf8");
 const api=readFileSync("apps/web/app/api/v1/search/route.ts","utf8");
 assert.doesNotMatch(page+api,/dangerouslySetInnerHTML/);
 assert.match(page,/robots: \{ index: false/);
 assert.match(page,/method="get"/);
 assert.match(api,/"X-Robots-Tag": "noindex"/);
 const sql=readFileSync("packages/db/src/public-search.ts","utf8");
 assert.match(sql,/FROM core_public_search/);
 assert.doesNotMatch(sql,/cms_revisions|cms_entries|identities|profiles/,"service must read only the safe view");
});
