import test from "node:test";
import assert from "node:assert/strict";
import {decide,mayGrant,PERMISSIONS,ROLES,STEP_UP_WINDOW_MS} from "../packages/core/src/authorization.ts";

const id="11111111-1111-4111-8111-111111111111",other="22222222-2222-4222-8222-222222222222";
const now=new Date("2026-11-15T12:00:00Z");
const subject=(grants,active=true)=>({id,active,grants:grants.map(([role,scope="core",extra={}])=>({role,scope,expiresAt:null,revokedAt:null,...extra}))});

// Expected matrix: role -> actions allowed on core scope.
const expected={
 admin:Object.keys(PERMISSIONS).filter(a=>!PERMISSIONS[a].self),
 editor:["cms.read_draft","cms.create_draft","cms.upload_media","cms.publish","admin.view"],
 reviewer:["cms.read_draft","cms.review","moderation.review","admin.view"],
 support:["privacy.process","admin.view"],
 viewer:["admin.view"]
};

test("role/permission matrix matches the documented policy exactly",()=>{
 for(const role of ROLES){
  for(const action of Object.keys(PERMISSIONS)){
   if(PERMISSIONS[action].self)continue;
   const allowed=decide(subject([[role]]),action,{scope:"core"},{now}).allowed;
   assert.equal(allowed,expected[role].includes(action),`${role} ${action}`);
  }
 }
});

test("deny by default: inactive, expired, revoked, unknown role, malformed input",()=>{
 assert.equal(decide(subject([["admin"]],false),"cms.review",{scope:"core"},{now}).reason,"denied_inactive");
 assert.equal(decide(subject([["admin","core",{expiresAt:new Date(now.getTime()-1)}]]),"cms.review",{scope:"core"},{now}).allowed,false);
 assert.equal(decide(subject([["admin","core",{revokedAt:now}]]),"cms.review",{scope:"core"},{now}).allowed,false);
 assert.equal(decide(subject([["superadmin"]]),"cms.review",{scope:"core"},{now}).allowed,false);
 assert.equal(decide({...subject([["admin"]]),id:"not-a-uuid"},"cms.review",{scope:"core"},{now}).reason,"denied_invalid");
 assert.equal(decide(subject([["admin"]]),"cms.delete_everything",{scope:"core"},{now}).reason,"denied_invalid");
 assert.equal(decide(subject([["admin"]]),"cms.review",{scope:"core' OR 1=1"},{now}).reason,"denied_invalid");
 assert.equal(decide(subject([["admin"]]),"constructor",{scope:"core"},{now}).reason,"denied_invalid");
});

test("scopes do not leak across organizations or sources",()=>{
 const orgEditor=subject([["editor","org:alpha"]]);
 assert.equal(decide(orgEditor,"cms.create_draft",{scope:"org:alpha"},{now}).allowed,true);
 assert.equal(decide(orgEditor,"cms.create_draft",{scope:"org:beta"},{now}).allowed,false);
 assert.equal(decide(orgEditor,"cms.create_draft",{scope:"core"},{now}).allowed,false);
 assert.equal(decide(subject([["editor"]]),"cms.create_draft",{scope:"org:alpha"},{now}).allowed,false,"core editor is not an org editor");
 assert.equal(decide(subject([["admin","org:alpha"]]),"roles.manage",{scope:"org:beta"},{now}).allowed,false);
 assert.equal(decide(subject([["admin"]]),"roles.manage",{scope:"org:beta"},{now}).allowed,true,"core admin covers all scopes");
});

test("self-service actions require ownership, never a role",()=>{
 assert.equal(decide(subject([]),"self.read",{scope:"core",ownerId:id},{now}).allowed,true);
 assert.equal(decide(subject([["admin"]]),"self.read",{scope:"core",ownerId:other},{now}).reason,"denied_not_owner","guessed IDs denied even for admins");
 assert.equal(decide(subject([]),"self.update",{scope:"core"},{now}).allowed,false);
});

test("privileged actions demand a fresh step-up when enforced",()=>{
 const admin=subject([["admin"]]);
 assert.equal(decide(admin,"roles.manage",{scope:"core"},{now,enforceStepUp:true}).reason,"denied_step_up");
 assert.equal(decide(admin,"roles.manage",{scope:"core"},{now,enforceStepUp:true,stepUpAt:new Date(now.getTime()-STEP_UP_WINDOW_MS-1)}).reason,"denied_step_up");
 assert.equal(decide(admin,"roles.manage",{scope:"core"},{now,enforceStepUp:true,stepUpAt:new Date(now.getTime()+60_000)}).reason,"denied_step_up","future step-up is invalid");
 assert.equal(decide(admin,"roles.manage",{scope:"core"},{now,enforceStepUp:true,stepUpAt:new Date(now.getTime()-60_000)}).allowed,true);
 assert.equal(decide(admin,"cms.review",{scope:"core"},{now,enforceStepUp:true}).allowed,true,"non-privileged unaffected");
});

test("grant administration: no self-grants, valid roles/scopes, admin only",()=>{
 const admin=subject([["admin"]]);
 assert.equal(mayGrant(admin,{id:other,role:"editor",scope:"core"},now),true);
 assert.equal(mayGrant(admin,{id,role:"editor",scope:"core"},now),false);
 assert.equal(mayGrant(admin,{id:other,role:"owner",scope:"core"},now),false);
 assert.equal(mayGrant(admin,{id:other,role:"editor",scope:"everything"},now),false);
 assert.equal(mayGrant(subject([["editor"]]),{id:other,role:"editor",scope:"core"},now),false);
});
