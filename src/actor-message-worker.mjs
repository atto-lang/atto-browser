/**
 * Transport-only worker endpoint: validates exact canonical MessagePack v2,
 * emits internal DATA receipts, honors a separate CONTROL drain channel.
 * Does not execute source-level Oreslang actor handlers.
 */
import {decodeActorMessageV2} from "./messagepack-v2.mjs";
let ready=false,closed=false,handling=false,stopPending=false,initializing=false,contract,lastTicket=0;
let guestHandler=null;
const MAX_WASM_BYTES=16*1024*1024;
// This Worker owns exactly one Wasm instance and never exposes its fields.
function hasStartSection(bytes){
 if(bytes.length<8||!bytes.slice(0,8).every((x,i)=>x===[0,97,115,109,1,0,0,0][i]))
  throw Error("invalid core Wasm header");
 let i=8,hasBoundedMemory=false;
 function u32(bound=bytes.length){
  let value=0;
  for(let j=0;j<5;j++){
   if(i>=bound)throw Error("truncated Wasm LEB128");
   const b=bytes[i++];
   if(j===4&&(b&0xf0))throw Error("invalid Wasm section size");
   value+=(b&127)*2**(7*j);
   if(!(b&128))return value;
  }
  throw Error("invalid Wasm section length");
 }
 while(i<bytes.length){
  const id=bytes[i++],size=u32(),end=i+size;
  if(end>bytes.length)throw Error("truncated Wasm section");
  if(id===5){
   // Read the actual core-Wasm memory declaration, not merely a caller's
   // artifact manifest. Importless guests have no other source of memory.
   if(hasBoundedMemory)throw Error("multiple Wasm memory sections");
   const count=u32(end);
   if(count!==1)throw Error("exactly one guest Wasm memory required");
   const flags=u32(end);
   if(flags!==1)throw Error("guest Wasm memory must declare an ordinary maximum");
   const min=u32(end),max=u32(end);
   if(min>2||max!==2||i!==end)
    throw Error("guest Wasm memory exceeds two-page ABI limit");
   hasBoundedMemory=true;
  }
  if(id===8)return true;
  i=end;
 }
 if(!hasBoundedMemory)throw Error("bounded Wasm memory section missing");
 return false;
}
async function loadActorGuest({wasmBytes,manifest}={}){
 if(!manifest||typeof manifest!=="object"||!wasmBytes)
  throw Error("actor guest artifact required");
 if(typeof SharedArrayBuffer!=="undefined"&&
    (wasmBytes instanceof SharedArrayBuffer||
     ArrayBuffer.isView(wasmBytes)&&wasmBytes.buffer instanceof SharedArrayBuffer))
  throw Error("shared actor Wasm bytes forbidden");
 const view=wasmBytes instanceof ArrayBuffer?new Uint8Array(wasmBytes):
   ArrayBuffer.isView(wasmBytes)?new Uint8Array(wasmBytes.buffer,wasmBytes.byteOffset,wasmBytes.byteLength):null;
 if(!view||view.byteLength===0||view.byteLength>MAX_WASM_BYTES)
  throw Error("actor Wasm byte budget");
 const bytes=Uint8Array.from(view);
 try{
  const actor=manifest.actor;
  if(manifest.schemaVersion!==1||manifest.artifactType!=="oreslang.core-wasm.actor-i64-v1"||
    manifest.target!=="wasm32"||manifest.environment!=="browser"||
    !Array.isArray(manifest.imports)||manifest.imports.length!==0||
    !Array.isArray(manifest.requiredCapabilities)||manifest.requiredCapabilities.length!==0||
    manifest.memory?.maximumPages!==2||manifest.wasmBytes!==bytes.byteLength||
    !/^[0-9a-f]{64}$/.test(manifest.wasmSha256||"")||
    !actor||typeof actor.name!=="string"||
    !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(actor.name)||
    actor.init!=="oreslang_actor_"+actor.name+"_init"||
    actor.onMessage!=="oreslang_actor_"+actor.name+"_on_message"||
    actor.messageShape!=="I"||actor.instancesPerActor!==1||
    manifest.entry!==actor.onMessage)throw Error("invalid actor Wasm manifest");
  const digest=new Uint8Array(await crypto.subtle.digest("SHA-256",bytes));
  const hex=Array.from(digest,b=>b.toString(16).padStart(2,"0")).join("");
  if(hex!==manifest.wasmSha256)throw Error("actor Wasm source hash mismatch");
  if(!WebAssembly.validate(bytes)||hasStartSection(bytes))
   throw Error("invalid or start-bearing actor Wasm");
  const module=await WebAssembly.compile(bytes);
  if(WebAssembly.Module.imports(module).length)
   throw Error("actor Wasm host imports forbidden");
  const exports=WebAssembly.Module.exports(module);
  if(![actor.init,actor.onMessage].every(name=>
      exports.some(x=>x.name===name&&x.kind==="function")))
   throw Error("missing actor Wasm exports");
  const instance=await WebAssembly.instantiate(module);
  const init=instance.exports[actor.init],handle=instance.exports[actor.onMessage];
  if(typeof init!=="function"||init.length!==0||
     typeof handle!=="function"||handle.length!==1)
   throw Error("wrong actor Wasm function arity");
  if(closed)throw Error("actor terminated during Wasm initialization");
  init();
  return handle;
 }finally{bytes.fill(0);scrubOwnedFrame(wasmBytes)}
}
// Worker postMessage() snapshots into private destination memory. Never
// mutate caller-owned SharedArrayBuffer data when rejecting a malformed frame.
function scrubOwnedFrame(frame){
 try{
  // The canonical decoder accepts ArrayBuffer and arbitrary typed-array
  // views, not only Uint8Array. Scrub exactly the Worker-owned input slice.
  const bytes=frame instanceof ArrayBuffer?new Uint8Array(frame):
    ArrayBuffer.isView(frame)?new Uint8Array(frame.buffer,frame.byteOffset,frame.byteLength):null;
  if(!bytes||(typeof SharedArrayBuffer!=="undefined"&&bytes.buffer instanceof SharedArrayBuffer))return;
  bytes.fill(0);
 }catch{}
}
self.addEventListener("message",async event=>{
 const data=event?.data;
 if(!data||typeof data!=="object")return panic();
 if(!ready){
  if(initializing||data.kind!=="oreslang-v2-init"||typeof data.schemaId!=="string"||
    typeof data.descriptor!=="string"){scrubOwnedFrame(data.frame);return panic()}
  initializing=true;
  contract={schemaId:data.schemaId,descriptor:data.descriptor};
  if(data.guest!==undefined){
   if(data.descriptor!=="I"){scrubOwnedFrame(data.guest?.wasmBytes);return panic()}
   try{guestHandler=await loadActorGuest(data.guest)}
   catch{scrubOwnedFrame(data.guest?.wasmBytes);return panic()}
  }
  if(closed)return;
  ready=true;
  self.postMessage({kind:"oreslang-v2-ready"});
  return;
 }
 if(closed){scrubOwnedFrame(data.frame);return}
 if(data.kind==="oreslang-v2-control"&&data.action==="drain"){
  stopPending=true;
  if(!handling){closed=true;self.postMessage({kind:"oreslang-v2-stopped"})}
  return;
 }
 if(data.kind!=="oreslang-v2-data"||!Number.isSafeInteger(data.id)||
   data.id<=lastTicket||handling||stopPending){
  // Malformed, replayed, or concurrent DATA still arrived as an owned
  // structured-clone buffer. Discard it before raising supervisor CONTROL.
  scrubOwnedFrame(data.frame);return panic();
 }
 // Admission gaps are permitted (failed serialization can consume an ID),
 // but a previously seen ticket can never be delivered or acknowledged twice.
 lastTicket=data.id;
 handling=true;
 try{
  // Decode owns a snapshot before WebCrypto. Never expose incoming mutable
  // frame bytes to an untrusted actor callback or reuse borrowed buffers.
  const decoded=await decodeActorMessageV2({...contract,bytes:data.frame});
  // Decoding yields to WebCrypto. A replay, bad DATA or failed CONTROL can
  // terminally panic the actor while this turn is suspended. A receipt fence
  // alone is insufficient: no source actor code may START after that panic.
  if(closed)return;
  const actorResult=guestHandler===null?undefined:guestHandler(decoded);
  if(guestHandler!==null&&typeof actorResult!=="bigint")
   throw Error("compiled actor handler must return signed i64");
  // A concurrent malformed/replayed DATA can trigger a terminal panic
  // while the SHA-256 digest is pending. Never ACK after that CONTROL event.
  if(!closed)self.postMessage({kind:"oreslang-v2-receipt",id:data.id,ok:true,
   ...(guestHandler===null?{}:{result:actorResult})});
 }catch{panic();return}
 finally{
  // The decode procedure copies untrusted bytes before its crypto await;
  // wipe the Worker-owned input buffer on both acceptance and rejection.
  scrubOwnedFrame(data.frame);
  handling=false;
  if(stopPending&&!closed){closed=true;self.postMessage({kind:"oreslang-v2-stopped"})}
 }
});
function panic(){
 if(closed)return;closed=true;
 // Revoke the compiled handler immediately. Even a pending decoder must not
 // retain an executable actor entry point after terminal shutdown.
 guestHandler=null;
 // No user-defined actor hook may intercept this terminal CONTROL failure.
 self.postMessage({kind:"oreslang-v2-panic"});
}
