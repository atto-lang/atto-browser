import {snapshotCoreManifest} from "./core-manifest-snapshot.mjs";
/**
 * Single-shot browser Worker admission for a SHA-256 pinned core-i64 Wasm guest.
 * This is isolation for pure scalar guests, NOT an Oreslang actor runtime.
 * Caller-provided workerFactory must create an actual trusted isolated Worker.
 */
const signedI64=/^(?:0|-?[1-9][0-9]*)$/;
const fail=x=>{throw new TypeError("Oreslang Worker: "+x)};
// Capture native internal-slot getters: instanceof and the public view.buffer
// accessor can both be forged, including on a SharedArrayBuffer-backed view.
const ordinaryBufferLength=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,"byteLength").get;
// Uint8Array.from reads an overrideable @@iterator on guest-supplied views.
const copyNative=Function.prototype.call.bind(Uint8Array.prototype.set);
const typedViewPrototype=Object.getPrototypeOf(Uint8Array.prototype);
const typedViewBuffer=Object.getOwnPropertyDescriptor(typedViewPrototype,"buffer").get;
const typedViewOffset=Object.getOwnPropertyDescriptor(typedViewPrototype,"byteOffset").get;
const typedViewLength=Object.getOwnPropertyDescriptor(typedViewPrototype,"byteLength").get;
const dataViewBuffer=Object.getOwnPropertyDescriptor(DataView.prototype,"buffer").get;
const dataViewOffset=Object.getOwnPropertyDescriptor(DataView.prototype,"byteOffset").get;
const dataViewLength=Object.getOwnPropertyDescriptor(DataView.prototype,"byteLength").get;
function isOrdinaryBuffer(value) {
 try { ordinaryBufferLength.call(value); return true; } catch { return false; }
}
function snapshotBytes(input,maxModuleBytes){
 let bytes;
 if(isOrdinaryBuffer(input))bytes=new Uint8Array(input);
 else if(ArrayBuffer.isView(input)) {
  let buffer,offset,length;
  try {
   const dataView=input instanceof DataView;
   buffer=(dataView?dataViewBuffer:typedViewBuffer).call(input);
   offset=(dataView?dataViewOffset:typedViewOffset).call(input);
   length=(dataView?dataViewLength:typedViewLength).call(input);
  }catch{fail("invalid or detached Wasm byte view")}
  if(!isOrdinaryBuffer(buffer))fail("shared memory not admitted");
  bytes=new Uint8Array(buffer,offset,length);
 }else fail("expected Wasm ArrayBuffer or typed array");
 if(bytes.byteLength>maxModuleBytes)fail("Wasm module exceeds host byte budget");
 // Copy raw internal slots without invoking an untrusted @@iterator.
 const snapshot=new Uint8Array(bytes.byteLength);
 copyNative(snapshot,bytes);
 return snapshot;
}
function validInt(x,min,max,name){
 if(!Number.isSafeInteger(x)||x<min||x>max)fail("invalid "+name);
 return x;
}
export function runVerifiedCoreGuestInWorker({
 wasmBytes,manifest,workerFactory,signal,
 timeoutMs=5000,maxModuleBytes=1048576,maxMemoryPages=32
}={}){
 validInt(timeoutMs,1,30000,"timeoutMs");
 validInt(maxModuleBytes,8,1048576,"maxModuleBytes");
 validInt(maxMemoryPages,1,256,"maxMemoryPages");
 if(signal!==undefined&&(!signal||typeof signal.aborted!=="boolean"||
    typeof signal.addEventListener!=="function"||typeof signal.removeEventListener!=="function"))
  fail("signal must be an AbortSignal-like cancellation source");
 // An already aborted request must not create a Worker or allocate guest memory.
 if(signal?.aborted)return Promise.reject(new Error("isolated Wasm worker aborted"));
 // Snapshot before any worker creation, event registration or async operation.
 const bytes=snapshotBytes(wasmBytes,maxModuleBytes);
 if(bytes.length>maxModuleBytes)fail("Wasm module exceeds host byte budget");
 const admittedManifest=snapshotCoreManifest(manifest);
 if(!admittedManifest||typeof admittedManifest!=="object"||Array.isArray(admittedManifest))
  fail("invalid artifact manifest");
 const create=workerFactory||(()=>{
  if(typeof Worker!=="function")fail("Web Worker is unavailable");
  return new Worker(new URL("./guest-worker.mjs",import.meta.url),{type:"module"});
 });
 return new Promise((resolve,reject)=>{
  let worker,done=false,deadline,abortRegistered=false;
  const onAbort=()=>settle(new Error("isolated Wasm worker aborted"));
  const cleanup=()=>{
   if(deadline!==undefined)clearTimeout(deadline);
   if(abortRegistered){
    try{signal.removeEventListener("abort",onAbort);}catch{}
    abortRegistered=false;
   }
   if(worker){
    for(const [kind,cb] of [["message",onMessage],["error",onError],["messageerror",onError]]){
     try{worker.removeEventListener(kind,cb);}catch{}
    }
    try{const termination=worker.terminate();if(termination&&typeof termination.catch==="function")termination.catch(()=>{});}catch{}
   }
  };
  const settle=(error,value)=>{
   if(done)return;
   done=true;cleanup();
   if(error)reject(error);else resolve(value);
  };
  const onError=()=>settle(new Error("isolated Wasm worker failed"));
  const onMessage=event=>{
   try {
   const data=event?.data;
   if(!data||data.kind!=="oreslang-core-result-v1"||typeof data.ok!=="boolean")
    return settle(new Error("invalid isolated Wasm worker response"));
   if(!data.ok)return settle(new Error("verified Wasm guest execution rejected"));
   const str=data.value;
   if(typeof str!=="string"||str.length>20||!signedI64.test(str))
    return settle(new Error("invalid signed i64 Worker result"));
   const value=BigInt(str);
   if(value<-(1n<<63n)||value>(1n<<63n)-1n)
    return settle(new Error("out-of-range signed i64 Worker result"));
   settle(null,value);
   } catch {
    // Synthetic or misbehaving Worker event accessors must settle the promise,
    // never escape as an uncaught message handler exception.
    settle(new Error("invalid isolated Wasm worker response"));
   }
  };
  try{
   worker=create();
   if(!worker||typeof worker.addEventListener!=="function"||
      typeof worker.removeEventListener!=="function"||
      typeof worker.postMessage!=="function"||
      typeof worker.terminate!=="function")
    fail("workerFactory must create a dedicated isolated Worker");
   worker.addEventListener("message",onMessage);
   worker.addEventListener("error",onError);
   worker.addEventListener("messageerror",onError);
   // Register cancellation before exposing guest input. A synchronous abort
   // during workerFactory creation or subscription must fail closed too.
   if(signal){
    signal.addEventListener("abort",onAbort,{once:true});
    abortRegistered=true;
    if(signal.aborted)return settle(new Error("isolated Wasm worker aborted"));
   }
   if(done)return;
   deadline=setTimeout(()=>settle(new Error("isolated Wasm worker deadline exceeded")),timeoutMs);
   // Deliberately omit transfer list: guest module bytes have copy semantics.
   if(done)return;
   worker.postMessage({kind:"oreslang-core-run-v1",wasmBytes:bytes,
    manifest:admittedManifest,maxModuleBytes,maxMemoryPages});
  }catch(error){settle(error)}
 });
}
