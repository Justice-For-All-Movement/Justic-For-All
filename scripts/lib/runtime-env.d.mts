export type RuntimeEnvSpec={name:string;requiredIn:string[];service:string;purpose:string;secret?:boolean;validate:(value:string,env:Record<string,string|undefined>)=>boolean};
export declare const RUNTIME_ENV:readonly RuntimeEnvSpec[];
export declare function isPublicOrigin(value:string,production:boolean):boolean;
export declare function checkRuntimeEnv(env:Record<string,string|undefined>,spec?:readonly RuntimeEnvSpec[]):{ok:boolean;problems:string[]};
