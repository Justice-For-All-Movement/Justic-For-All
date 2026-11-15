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
 {name:"IDENTITY_LOOKUP_KEY",requiredIn:[],service:"Accounts (JFA-19)",secret:true,
  purpose:"32-byte base64 key for keyed email lookup and throttle buckets; accounts stay closed without it.",
  validate:v=>isKey(v)},
 {name:"CONTACT_ENCRYPTION_KEY",requiredIn:[],service:"Accounts (JFA-19)",secret:true,
  purpose:"32-byte base64 AES-256-GCM key sealing stored email addresses; must differ from IDENTITY_LOOKUP_KEY.",
  validate:(v,env)=>isKey(v)&&v!==env.IDENTITY_LOOKUP_KEY},
 {name:"EMAIL_PROVIDER",requiredIn:[],service:"Transactional email",
  purpose:"disabled (default) | resend; memory/log are development-only and refused in production.",
  validate:(v,env)=>["disabled","resend"].includes(v)||(env.NODE_ENV!=="production"&&["memory","log"].includes(v))},
 {name:"EMAIL_PROVIDER_API_KEY",requiredIn:[],service:"Resend (when EMAIL_PROVIDER=resend)",secret:true,
  purpose:"Provider API key.",validate:v=>v.length>=8&&!/\s/.test(v)},
 {name:"EMAIL_FROM_ADDRESS",requiredIn:[],service:"Resend (verified sender domain)",
  purpose:"Verified sender, e.g. Justice For All <no-reply@example.org>.",
  validate:v=>/^([^<>@\r\n]{1,80} <)?[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>?$/.test(v)},
 {name:"PORT",requiredIn:[],service:"Render (injected automatically)",purpose:"Listen port; defaults to 3000.",
  validate:v=>/^\d{2,5}$/.test(v)&&Number(v)<65536},
 {name:"HOST",requiredIn:[],service:"Render",purpose:"Bind address; defaults to 0.0.0.0.",
  validate:v=>/^[0-9a-f.:]+$/i.test(v)||v==="localhost"},
]);

function isKey(v){
 try{return Buffer.from(v.trim(),/[-_]/.test(v)?"base64url":"base64").length===32;}catch{return false;}
}

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
 if(env.EMAIL_PROVIDER==="resend"&&(!env.EMAIL_PROVIDER_API_KEY||!env.EMAIL_FROM_ADDRESS))
  problems.push("EMAIL_PROVIDER=resend needs EMAIL_PROVIDER_API_KEY and EMAIL_FROM_ADDRESS");
 return {ok:problems.length===0,problems};
}
