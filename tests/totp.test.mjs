import test from "node:test";
import assert from "node:assert/strict";
import {totpAt,matchTotp,base32Encode,base32Decode} from "../packages/security/src/totp.ts";

test("RFC 6238 Appendix B test vectors (SHA-1, 8 digits)",()=>{
 const key=Buffer.from("12345678901234567890");
 for(const [t,code] of [[59,"94287082"],[1111111109,"07081804"],[1111111111,"14050471"],[1234567890,"89005924"],[2000000000,"69279037"],[20000000000,"65353130"]])
  assert.equal(totpAt("",Math.floor(t/30),8,"sha1",key),code,String(t));
});

test("base32 round trip and drift window",()=>{
 const raw=Buffer.from("hello world 12345");
 assert.deepEqual(base32Decode(base32Encode(raw)),raw);
 const secret=base32Encode(Buffer.from("12345678901234567890"));
 const now=1_763_200_000_000,step=Math.floor(now/30000);
 assert.equal(matchTotp(secret,totpAt(secret,step),now),step);
 assert.equal(matchTotp(secret,totpAt(secret,step-1),now),step-1);
 assert.equal(matchTotp(secret,totpAt(secret,step+2),now),null);
 for(const bad of ["12345","abcdef",123456,null,"1234567"])assert.equal(matchTotp(secret,bad,now),null);
});
