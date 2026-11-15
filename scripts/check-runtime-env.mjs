// Fail fast at deploy start with variable NAMES only; values are never printed.
import {checkRuntimeEnv} from "./lib/runtime-env.mjs";

const result=checkRuntimeEnv(process.env);
if(!result.ok){
 console.error("Runtime configuration is incomplete:");
 for(const problem of result.problems)console.error(` - ${problem}`);
 console.error("See docs/DEPLOYMENT_RENDER.md for the variable reference.");
 process.exitCode=1;
}else{
 console.info("Runtime configuration check passed.");
}
