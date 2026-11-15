import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {checkRuntimeEnv,RUNTIME_ENV,isPublicOrigin} from "../scripts/lib/runtime-env.mjs";

const prod={NODE_ENV:"production",DATABASE_URL:"postgresql://app:pw@ep-x.neon.tech/jfa?sslmode=require",APP_PUBLIC_URL:"https://jfa.example.org"};

test("production requires database and public origin and never echoes values",()=>{
 assert.deepEqual(checkRuntimeEnv(prod),{ok:true,problems:[]});
 const missing=checkRuntimeEnv({NODE_ENV:"production"});
 assert.equal(missing.ok,false);
 assert.ok(missing.problems.some(p=>p.startsWith("DATABASE_URL is required")));
 assert.ok(missing.problems.some(p=>p.startsWith("APP_PUBLIC_URL is required")));
 const bad=checkRuntimeEnv({...prod,DATABASE_URL:"postgresql://app:supersecret@host/jfa"});
 assert.equal(bad.ok,false);
 assert.ok(!bad.problems.join(" ").includes("supersecret"));
});

test("public origin must be a bare https origin in production",()=>{
 assert.equal(isPublicOrigin("https://jfa.example.org",true),true);
 for(const v of ["http://jfa.example.org","https://localhost","https://x.org/path","https://u:p@x.org","not a url"])
  assert.equal(isPublicOrigin(v,true),false,v);
 assert.equal(isPublicOrigin("http://localhost:3000",false),true);
});

test("development needs nothing; invalid optional values are still reported",()=>{
 assert.equal(checkRuntimeEnv({}).ok,true);
 assert.equal(checkRuntimeEnv({PORT:"abc"}).ok,false);
});

test("render blueprint matches the runtime contract",()=>{
 const yaml=readFileSync("render.yaml","utf8");
 assert.match(yaml,/runtime: node/);
 assert.match(yaml,/key: NODE_VERSION\s+value: 22\./);
 assert.match(yaml,/buildCommand: .*pnpm install --frozen-lockfile && pnpm build/);
 assert.match(yaml,/startCommand: pnpm start:render/);
 assert.match(yaml,/healthCheckPath: \/health/);
 assert.match(yaml,/key: HOST\s+value: 0\.0\.0\.0/);
 assert.match(yaml,/key: DATABASE_URL\s+(#.*\s+)?sync: false/);
 assert.match(yaml,/key: NODE_ENV\s+value: production/);
 assert.match(yaml,/key: APP_PUBLIC_URL/);
 assert.doesNotMatch(yaml,/postgres(ql)?:\/\//,"no connection strings in the blueprint");
 const required=RUNTIME_ENV.filter(v=>v.requiredIn.includes("production")).map(v=>v.name);
 for(const name of required)assert.ok(yaml.includes(`key: ${name}`),`${name} must be declared in render.yaml`);
 const pkg=JSON.parse(readFileSync("package.json","utf8"));
 assert.match(pkg.scripts["start:render"],/check-runtime-env\.mjs && pnpm db:migrate && pnpm start/);
 const web=JSON.parse(readFileSync("apps/web/package.json","utf8"));
 assert.match(web.scripts.start,/--hostname \$\{HOST:-0\.0\.0\.0\} --port \$\{PORT:-3000\}/);
});
