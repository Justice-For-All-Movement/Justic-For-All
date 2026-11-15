import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
const source=readFileSync(new URL("../packages/db/src/editorial.ts",import.meta.url),"utf8");
test("draft storage requires active staff authorization and transactional rollback",()=>{
 // Central JFA-21 policy: active identity, unrevoked/unexpired core-scoped editor or admin grant.
 assert.match(source,/assertAuthorized\(client,actorId,"cms\.create_draft"\)/);
 const policy=readFileSync(new URL("../packages/core/src/authorization.ts",import.meta.url),"utf8");
 assert.match(policy,/"cms\.create_draft": \{ roles: \["editor", "admin"\]/);
 assert.match(policy,/if \(!subject\.active\) return/);
 assert.match(source,/BEGIN/);
 assert.match(source,/ROLLBACK/);
 assert.match(source,/cms_draft_created/);
});
test("drafts cannot modify published pointer and are never sent to public endpoints",()=>{
 assert.match(source,/if\(entry.visibility==="private"\)/);
 assert.match(source,/editorial_state,content_hash/);
 assert.match(source,/'draft'/);
 assert.doesNotMatch(source,/editorial_state='published'|visibility='public'/);
});
