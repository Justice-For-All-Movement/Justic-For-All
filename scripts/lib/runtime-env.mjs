import {parseDatabaseUrl} from "../../packages/db/src/config.mjs";

/**
 * Single source of truth for deployed runtime configuration names.
 * Values are never printed. `requiredIn` lists the NODE_ENV values in which
 * the variable must be present; everything else is optional with a safe,
 * disabled default.
 */
export const RUNTIME_ENV=Object.freeze([
 {name:"NODE_ENV",requiredIn:["production"],service:"Node.js runtime",purpose:"Must be `production` on Render.",
  validate:v=>["production","development","test"].includes(v)},
 {name:"DATABASE_URL",requiredIn:["production"],service:"Neon PostgreSQL",secret:true,
  purpose:"Core database connection string; production requires sslmode=require or verify-full.",
  validate:(v,env)=>parseDatabaseUrl(v,env.NODE_ENV==="production"?"production":"development").ok},
 {name:"APP_PUBLIC_URL",requiredIn:["production"],service:"Public origin (Render URL or custom domain)",
  purpose:"Canonical https origin for links, sitemap and Open Graph metadata.",
  validate:(v,env)=>isPublicOrigin(v,env.NODE_ENV==="production")},
 {name:"PORT",requiredIn:[],service:"Render (injected automatically)",purpose:"Listen port; defaults to 3000.",
  validate:v=>/^\d{2,5}$/.test(v)&&Number(v)<65536},
 {name:"HOST",requiredIn:[],service:"Render",purpose:"Bind address; defaults to 0.0.0.0.",
  validate:v=>/^[0-9a-f.:]+$/i.test(v)||v==="localhost"},
]);

export function isPublicOrigin(value,production){
 try{
  const url=new URL(value);
  if(url.pathname!=="/"||url.search||url.hash||url.username||url.password)return false;
  if(!production)return url.protocol==="https:"||url.protocol==="http:";
  return url.protocol==="https:"&&!["localhost","127.0.0.1","[::1]"].includes(url.hostname);
 }catch{return false;}
}

/** @returns {{ok:boolean, problems:string[]}} names and reasons only, never values */
export function checkRuntimeEnv(env,spec=RUNTIME_ENV){
 const mode=env.NODE_ENV||"development";
 const problems=[];
 for(const item of spec){
  const value=env[item.name];
  if(value===undefined||value===""){
   if(item.requiredIn.includes(mode))problems.push(`${item.name} is required (${item.service})`);
   continue;
  }
  if(!item.validate(value,env))problems.push(`${item.name} is invalid (${item.purpose})`);
 }
 return {ok:problems.length===0,problems};
}
