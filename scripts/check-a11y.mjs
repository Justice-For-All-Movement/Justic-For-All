// Run after `pnpm build`: checks every prerendered HTML page in the web app.
import {readdirSync,readFileSync,statSync} from "node:fs";
import {join,relative} from "node:path";
import {checkHtmlAccessibility} from "./lib/a11y-static.mjs";

const root="apps/web/.next/server/app";
const files=[];
const walk=dir=>{for(const name of readdirSync(dir)){const p=join(dir,name);if(statSync(p).isDirectory())walk(p);else if(p.endsWith(".html"))files.push(p);}};
try{walk(root);}catch{console.error("No build output found; run `pnpm build` first.");process.exit(1);}
let failures=0;
for(const file of files.sort()){
 const rel=relative(root,file);
 // Framework error shells are not public content pages.
 const problems=checkHtmlAccessibility(readFileSync(file,"utf8"),{allowMissingH1:rel.startsWith("_global-error")});
 if(rel.startsWith("_global-error"))continue;
 if(problems.length){failures++;console.error(`${rel}:\n  - ${problems.join("\n  - ")}`);}
}
if(files.length<10){console.error(`Expected prerendered pages, found ${files.length}.`);process.exit(1);}
console.log(`Static accessibility check: ${files.length} pages, ${failures} with problems.`);
if(failures)process.exitCode=1;
