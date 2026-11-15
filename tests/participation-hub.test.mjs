import test from "node:test";
import assert from "node:assert/strict";
import {existsSync,readFileSync} from "node:fs";
import {participationPaths,participationAvailability,publicResources} from "../packages/core/src/participation.ts";

const registry=JSON.parse(readFileSync("config/initiative-registry.v1.json","utf8"));
const slugs=new Set(registry.initiatives.map(i=>i.slug));
const pageFor=href=>{
 const m=href.match(/^\/initiatives\/([a-z0-9-]+)$/);
 if(m)return slugs.has(m[1])?"apps/web/app/initiatives/[slug]/page.tsx":null;
 return `apps/web/app${href}/page.tsx`;
};
const src=p=>readFileSync(p,"utf8");

test("every participation path routes to an implemented information page",()=>{
 const ids=new Set();
 for(const path of participationPaths){
  assert.ok(!ids.has(path.id));ids.add(path.id);
  assert.match(path.id,/^[a-z0-9-]+$/);
  const page=pageFor(path.destination);
  assert.ok(page&&existsSync(page),`${path.id} -> ${path.destination}`);
  for(const slug of path.initiativeSlugs)assert.ok(slugs.has(slug),`${path.id}: unknown initiative ${slug}`);
  assert.ok(path.safetyNote.length>20);
 }
 assert.ok(participationPaths.length>=5);
});

test("no path is available until every related initiative is verified live",()=>{
 for(const path of participationPaths){
  assert.equal(participationAvailability(path),"information_only");
  assert.equal(participationAvailability(path,new Set(path.initiativeSlugs.slice(0,-1))),"information_only");
  assert.equal(participationAvailability(path,new Set(path.initiativeSlugs)),"available");
 }
 assert.equal(participationAvailability({...participationPaths[0],initiativeSlugs:[]},new Set(["x"])),"information_only");
});

test("any program is reachable in two steps: home -> get involved -> path",()=>{
 const editorial=src("apps/web/content/editorial.ts");
 assert.match(editorial,/href: "\/get-involved"/);
 assert.match(src("apps/web/app/layout.tsx"),/"\/get-involved"/);
 const involved=src("apps/web/app/get-involved/page.tsx");
 assert.match(involved,/participationPaths\.map/);
 assert.match(involved,/href=\{path\.destination\}/);
});

test("hub pages contain no forms and no unverified availability claims",()=>{
 for(const p of ["get-involved","resources","safety","contact"]){
  const page=src(`apps/web/app/${p}/page.tsx`);
  assert.doesNotMatch(page,/<form|<input|type="submit"|mailto:/i,p);
 }
 assert.match(src("apps/web/app/get-involved/page.tsx"),/Information only — not open yet/);
 assert.match(src("apps/web/app/contact/page.tsx"),/Issues are public/);
});

test("resources are internal pages or official government https sites",()=>{
 for(const r of publicResources){
  if(r.kind==="internal"){const page=pageFor(r.href);assert.ok(page&&existsSync(page),r.href);}
  else{const u=new URL(r.href);assert.equal(u.protocol,"https:");assert.match(u.hostname,/\.gov$/,r.href);}
 }
 assert.match(src("apps/web/app/resources/page.tsx"),/rel="noopener noreferrer external"/);
});

test("new routes are in the route manifest and navigation list",()=>{
 const manifest=src("docs/ROUTE_MANIFEST.md"),routes=src("apps/web/lib/public-routes.ts");
 for(const r of ["/resources","/safety","/contact"]){assert.ok(manifest.includes(`${r} |`),r);assert.ok(routes.includes(`"${r}"`),r);}
});
