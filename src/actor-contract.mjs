/**
 * Admission-only validation for the canonical actor MessagePack v2 contract.
 * Run before spawning a Worker and again inside the isolated Worker on INIT.
 * This mirrors the codec's grammar without hashing or allocating DATA frames.
 */
const fail=()=>{throw new TypeError("Oreslang actor transport: invalid schema or descriptor byte budget/shape")};
export function validateActorWorkerContract(schemaId,descriptor){
 // Canonical v2 accepts printable ASCII (at most 256 schema and 4096
 // descriptor characters); for ASCII, character count equals UTF-8 bytes.
 if(typeof schemaId!=="string"||typeof descriptor!=="string"||
    !/^[\x21-\x7e]{1,256}$/.test(schemaId)||
    !/^[\x21-\x7e]{1,4096}$/.test(descriptor))fail();
 let at=0,nodes=0;
 function item(depth){
  if(depth>64||++nodes>100000)fail();
  for(const [token,fixed] of [["FA[",true],["FL[",true],["T[",true],["A[",false],["L[",false]]]){
   if(descriptor.startsWith(token,at)){
    at+=token.length;
    if(fixed){
     if(descriptor[at]!=="]"){
      do{item(depth+1);if(descriptor[at]!==",")break;at++}while(true);
     }
    }else item(depth+1);
    if(descriptor[at++]!=="]")fail();
    return;
   }
  }
  if(at>=descriptor.length||!"BIFS".includes(descriptor[at]))fail();
  at++;
 }
 item(0);
 if(at!==descriptor.length)fail();
}
