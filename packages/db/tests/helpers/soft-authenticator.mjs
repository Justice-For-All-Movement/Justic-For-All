// Test-only software WebAuthn authenticator (ES256, "none" attestation).
// Produces real CBOR attestation objects and ECDSA assertions so the server
// library verifies them exactly as it would a hardware authenticator.
import {createHash,generateKeyPairSync,randomBytes,sign} from "node:crypto";
import {isoCBOR} from "@simplewebauthn/server/helpers";

const b64u=b=>Buffer.from(b).toString("base64url");
const sha256=b=>createHash("sha256").update(b).digest();

export function createSoftAuthenticator({rpID,origin}){
 const {privateKey,publicKey}=generateKeyPairSync("ec",{namedCurve:"P-256"});
 const jwk=publicKey.export({format:"jwk"});
 const credId=randomBytes(32);
 let counter=0;
 const cose=isoCBOR.encode(new Map([[1,2],[3,-7],[-1,1],[-2,Buffer.from(jwk.x,"base64url")],[-3,Buffer.from(jwk.y,"base64url")]]));
 const authData=(flags,attested)=>{const c=Buffer.alloc(4);c.writeUInt32BE(counter);return Buffer.concat([sha256(rpID),Buffer.from([flags]),c,attested??Buffer.alloc(0)]);};
 const clientData=(type,challenge,o=origin)=>Buffer.from(JSON.stringify({type,challenge,origin:o,crossOrigin:false}));
 return {
  id:b64u(credId),
  register(options,{originOverride,uv=true}={}){
   const len=Buffer.alloc(2);len.writeUInt16BE(credId.length);
   const ad=authData(0x41|(uv?0x04:0),Buffer.concat([Buffer.alloc(16),len,credId,Buffer.from(cose)]));
   const att=isoCBOR.encode(new Map([["fmt","none"],["attStmt",new Map()],["authData",ad]]));
   return {id:b64u(credId),rawId:b64u(credId),type:"public-key",clientExtensionResults:{},authenticatorAttachment:"platform",
    response:{clientDataJSON:b64u(clientData("webauthn.create",options.challenge,originOverride)),attestationObject:b64u(att),transports:["internal"]}};
  },
  assert(options,{originOverride,keepCounter=false}={}){
   if(!keepCounter)counter++;
   const ad=authData(0x05);const cd=clientData("webauthn.get",options.challenge,originOverride);
   const sig=sign("sha256",Buffer.concat([ad,sha256(cd)]),privateKey);
   return {id:b64u(credId),rawId:b64u(credId),type:"public-key",clientExtensionResults:{},
    response:{clientDataJSON:b64u(cd),authenticatorData:b64u(ad),signature:b64u(sig)}};
  }
 };
}
