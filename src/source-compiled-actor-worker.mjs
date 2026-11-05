/**
 * Experimental source-compiled Wasm32 guest actor endpoint.
 * One dedicated module Worker owns one import-free compiled actor instance.
 * Protocol DATA carries canonical MessagePack v2 *scalar i64* values.
 * No native OresVM scheduler or source ActorRef/await/supervisor ABI here.
 */
import {decodeActorMessageV2,validateActorMessageV2Contract} from "./messagepack-v2.mjs";
import {inspectWasmBytes} from "./inspect.mjs";
const MAX_GUEST_BYTES=1048576;
let phase="NEW",contract=null,guest=null,lastTicket=0,handling=false,stopPending=false;
const ownedBytes=value=>{
 const isShared=b=>typeof SharedArrayBuffer!=="undefined"&&b instanceof SharedArrayBuffer;
 if(isShared(value))return null;
 if(value instanceof ArrayBuffer)return new Uint8Array(value);
 if(ArrayBuffer.isView(value)&&!isShared(value.buffer))
  return new Uint8Array(value.buffer,value.byteOffset,value.byteLength);
 return null;
};
function scrub(value){
 try{ownedBytes(value)?.fill(0)}catch{}
}
// Take ownership of the guest before invoking untrusted/destructing Wasm.
// A teardown trap must never cause supervisor panic to invoke teardown twice.
function retireGuest(){
 const retiring=guest;
 guest=null;
 retiring?.oreslang_wasm_actor_teardown();
}
function panic(){
 if(phase==="STOPPED"||phase==="PANICKED")return;
 phase="PANICKED";
 try{retireGuest()}catch{}
 self.postMessage({kind:"oreslang-v2-panic"});
}
async function load(data){
 let owned=null,inspected=null;
 try{
  if(phase!=="NEW"||data.kind!=="oreslang-v2-source-init"||
    data.descriptor!=="I"||!validateActorMessageV2Contract(data)||
    typeof data.wasmSha256!=="string"||!/^[a-f0-9]{64}$/.test(data.wasmSha256))
   throw Error("invalid compiled actor INIT");
  const bytes=ownedBytes(data.wasm);
  if(!bytes||bytes.length===0||bytes.length>MAX_GUEST_BYTES)
   throw Error("invalid compiled actor byte budget");
  phase="LOADING";
  owned=Uint8Array.from(bytes);
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",owned)))
   .map(x=>x.toString(16).padStart(2,"0")).join("");
  // WebCrypto yields to the Worker event loop: terminal CONTROL or a
  // concurrent invalid DATA can panic while the digest is pending.
  // A cancelled init must never compile or invoke any guest export.
  if(phase!=="LOADING")throw Error("INIT cancelled during digest");
  if(hash!==data.wasmSha256)throw Error("compiled actor digest mismatch");
  // Require a fixed two-page maximum, no start function, no table, and no
  // unbounded memory growth. Compile the exact inspected private snapshot.
  inspected=inspectWasmBytes(owned,{maxModuleBytes:MAX_GUEST_BYTES,maxMemoryPages:2});
  if(inspected.memoryCount!==1||!inspected.hasMemoryMaximum)
   throw Error("compiled actor requires bounded guest memory");
  const module=await WebAssembly.compile(inspected.bytes);
  if(WebAssembly.Module.imports(module).length!==0)
   throw Error("compiled actor has forbidden imports");
  const exports=WebAssembly.Module.exports(module);
  const required=["oreslang_wasm_actor_init","oreslang_wasm_actor_on_message",
    "oreslang_wasm_actor_teardown"];
  for(const name of required)
   if(!exports.some(x=>x.name===name&&x.kind==="function"))
    throw Error("missing compiler-generated actor ABI "+name);
  if(phase!=="LOADING")throw Error("INIT cancelled during compilation");
  const instance=new WebAssembly.Instance(module);
  for(const name of required)if(typeof instance.exports[name]!=="function")
   throw Error("incorrect guest ABI");
  // This must precede guest init(), not follow it: initialization is itself
  // guest execution and must be excluded after a terminal panic.
  if(phase!=="LOADING")throw Error("INIT cancelled before guest entry");
  instance.exports.oreslang_wasm_actor_init();
  guest=instance.exports;
  contract={schemaId:data.schemaId,descriptor:"I"};
  phase="ACTIVE";
  self.postMessage({kind:"oreslang-v2-ready"});
 }catch{panic()}finally{scrub(inspected?.bytes);scrub(owned);scrub(data.wasm)}
}
function stop(){
 if(phase!=="ACTIVE"||handling)return;
 try{retireGuest()}
 catch{panic();return}
 phase="STOPPED";
 self.postMessage({kind:"oreslang-v2-stopped"});
}
self.addEventListener("message",async event=>{
 const data=event?.data;
 if(!data||typeof data!=="object"){panic();return}
 if(phase==="NEW"){await load(data);return}
 if(phase==="PANICKED"||phase==="STOPPED"){scrub(data.frame);scrub(data.wasm);return}
 if(phase==="LOADING"){scrub(data.frame);scrub(data.wasm);panic();return}
 if(data.kind==="oreslang-v2-control"&&data.action==="drain"){
  stopPending=true;
  if(!handling)stop();
  return;
 }
 if(data.kind!=="oreslang-v2-data"||!Number.isSafeInteger(data.id)||
    data.id<=lastTicket||handling||stopPending){
  scrub(data.frame);panic();return;
 }
 const frame=data.frame;
 lastTicket=data.id;handling=true;
 try{
  const message=await decodeActorMessageV2({...contract,bytes:frame});
  if(phase!=="ACTIVE")return;
  const result=guest.oreslang_wasm_actor_on_message(message);
  if(typeof result!=="bigint")throw Error("actor result ABI mismatch");
  self.postMessage({kind:"oreslang-v2-receipt",id:data.id,ok:true,result});
 }catch{panic()}
 finally{
  scrub(frame);handling=false;
  if(stopPending&&phase==="ACTIVE")stop();
 }
});
