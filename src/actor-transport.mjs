/**
 * Experimental host-side, bounded actor DATA transport over a real dedicated
 * Worker. This is NOT guest Oreslang actor code, a scheduler or compiler lowering.
 * Internal delivery receipts are distinct from user-visible send acknowledgments.
 */
import {encodeActorMessageV2,validateActorMessageV2Contract} from "./messagepack-v2.mjs";
const fail=s=>{throw new Error("Oreslang actor transport: "+s)};
// Captured intrinsic accessors cannot be shadowed by an untrusted typed-array
// instance's own .buffer, .byteOffset or .byteLength properties.
// View metadata is validated through native slots. Snapshot via a captured
// intrinsic too: Uint8Array.from invokes replaceable Symbol.iterator hooks.
const copyNative=Function.prototype.call.bind(Uint8Array.prototype.set);
const taPrototype=Object.getPrototypeOf(Uint8Array.prototype);
const taBuffer=Object.getOwnPropertyDescriptor(taPrototype,"buffer").get;
const taOffset=Object.getOwnPropertyDescriptor(taPrototype,"byteOffset").get;
const taLength=Object.getOwnPropertyDescriptor(taPrototype,"byteLength").get;
const dvBuffer=Object.getOwnPropertyDescriptor(DataView.prototype,"buffer").get;
const dvOffset=Object.getOwnPropertyDescriptor(DataView.prototype,"byteOffset").get;
const dvLength=Object.getOwnPropertyDescriptor(DataView.prototype,"byteLength").get;
const abLength=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,"byteLength").get;
const sabLength=typeof SharedArrayBuffer==="function"?
 Object.getOwnPropertyDescriptor(SharedArrayBuffer.prototype,"byteLength").get:null;
const isRealBacking=(getter,value)=>{try{getter?.call(value);return !!getter}catch{return false}};
function viewBacking(view){
 if(!ArrayBuffer.isView(view))return null;
 try{return {buffer:taBuffer.call(view),offset:taOffset.call(view),length:taLength.call(view)}}
 catch{return {buffer:dvBuffer.call(view),offset:dvOffset.call(view),length:dvLength.call(view)}}
}

/* Worker adapters may detach/transfer postMessage frames. A failed scrub
 * must never abort terminalization, release the incarnation lease early, or
 * turn a successful receipt into a second actor execution. */
// Scrubbing must not depend on a mutable fill prototype or shadowed view slots.
const scrubNative=Function.prototype.call.bind(Uint8Array.prototype.fill);
function scrubOwned(value) {
 if(value===null||value===undefined)return;
 try {
  let backing,offset=0,length;
  if(isRealBacking(abLength,value)){
   backing=value;length=abLength.call(value);
  }else{
   const slots=viewBacking(value);
   if(!slots)return;
   ({buffer:backing,offset,length}=slots);
  }
  if(!isRealBacking(abLength,backing)||isRealBacking(sabLength,backing))return;
  scrubNative(new Uint8Array(backing,offset,length),0);
 }catch{
  // Detached host allocations can no longer be read or written.
 }
}
// This process-local authority is deliberately not a cross-tab or cross-host
// lock. A guest actorKey cannot be reused until its carrier terminates.
const activeIncarnations=new Map();
function newIncarnation(){
 const bytes=new Uint8Array(16);
 crypto.getRandomValues(bytes);
 return Array.from(bytes,x=>x.toString(16).padStart(2,"0")).join("");
}
export function createActorMessageTransport({
 schemaId,descriptor,capacity=16,timeoutMs=5000,workerFactory,onSupervisorPanic,
 guest,actorKey,maxFrameBytes=1048576,maxReservedBytes=4194304
}={}){
 // Use the exact canonical codec grammar for both host preflight and Worker
 // INIT. In particular this rejects malformed nesting before carrier creation.
 try{validateActorMessageV2Contract({schemaId,descriptor})}
 catch(error){
  const budget=/invalid schema ID|invalid shape descriptor/.test(String(error?.message||""));
  fail(budget?"invalid schema or descriptor byte budget":"invalid schema or descriptor shape");
 }
 if(!Number.isSafeInteger(capacity)||capacity<1||capacity>4096)fail("invalid capacity");
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)fail("invalid deadline");
 if(!Number.isSafeInteger(maxFrameBytes)||maxFrameBytes<64||maxFrameBytes>1048576)fail("invalid frame byte budget");
 if(!Number.isSafeInteger(maxReservedBytes)||maxReservedBytes<maxFrameBytes||maxReservedBytes>67108864)
  fail("invalid total reserved byte budget");
 if(guest!==undefined &&
    (typeof actorKey!=="string"||actorKey.length<1||actorKey.length>128||
     !/^[a-zA-Z0-9_.:/-]+$/.test(actorKey)))
  fail("compiled guest requires stable bounded actorKey");
 if(guest===undefined&&actorKey!==undefined)
  fail("actorKey is only valid for compiled actor guests");
 // Clone before admission; the caller retains ownership of its original Wasm
 // bytes. Never let a SharedArrayBuffer reach the execution Worker.
 let guestBytes=null;
 if(guest!==undefined){
  if(descriptor!=="I"||!guest||typeof guest!=="object"||
     !guest.manifest||typeof guest.manifest!=="object")
   fail("compiled actor guest requires i64 descriptor and manifest");
  const supplied=guest.wasmBytes;
  const viewInfo=ArrayBuffer.isView(supplied)?viewBacking(supplied):null;
  // Check actual internal backing slots, never replaceable .buffer accessors.
  if(isRealBacking(sabLength,supplied)||
     (viewInfo&&isRealBacking(sabLength,viewInfo.buffer)))
   fail("actor guest shared memory forbidden");
  const view=isRealBacking(abLength,supplied)?new Uint8Array(supplied):
   viewInfo?new Uint8Array(viewInfo.buffer,viewInfo.offset,viewInfo.length):null;
  if(!view||!view.byteLength||view.byteLength>16*1024*1024)
   fail("actor guest Wasm byte budget");
  guestBytes=new Uint8Array(view.byteLength);
  copyNative(guestBytes,view);
 }
 // Generation-fenced local actor lease. No second Worker with the same
 // supervisor-provided actor identity can be spawned while retirement is
 // unconfirmed, including after stop() has already been requested.
 const incarnation=guest===undefined?null:newIncarnation();
 if(actorKey!==undefined){
  if(activeIncarnations.has(actorKey)){
   scrubOwned(guestBytes);
   fail("actor incarnation still active or termination unconfirmed");
  }
  activeIncarnations.set(actorKey,incarnation);
 }
 const create=workerFactory||(()=>{
  if(typeof Worker!=="function")fail("dedicated Web Worker unavailable");
  return new Worker(new URL("./actor-message-worker.mjs",import.meta.url),{type:"module"});
 });
 let worker;
 try{worker=create()}catch(error){
  scrubOwned(guestBytes);
  if(actorKey!==undefined&&activeIncarnations.get(actorKey)===incarnation)
   activeIncarnations.delete(actorKey);
  throw error
 }
 if(!worker||["postMessage","addEventListener","removeEventListener","terminate"].some(x=>typeof worker[x]!=="function")){
  // A broken factory may already have allocated a live OS Worker before
  // returning an incomplete adapter. Revoke it rather than leaking a carrier.
  scrubOwned(guestBytes);
  // Terminate at most once. Never release an identity until its carrier
  // confirms retirement; an unconfirmed carrier retains the fence.
  try{
   const termination=worker?.terminate?.();
   if(termination&&typeof termination.then==="function")
    termination.then(()=>{
     if(actorKey!==undefined&&activeIncarnations.get(actorKey)===incarnation)
      activeIncarnations.delete(actorKey);
    }).catch(()=>{});
   // A void terminate() supplies no physical-retirement receipt.
   // Keep the identity reserved until another trusted barrier proves exit.
  }catch{}
  fail("trusted dedicated Worker required");
 }
 let pending=0,ready=false,active=null,sealed=false,stopping=false,finished=false,seq=0,deadline;
 let pumping=false,repump=false,terminalError=null;
 const queue=[];
 let doneResolve,doneReject;
 const done=new Promise((resolve,reject)=>{doneResolve=resolve;doneReject=reject});
 // The completion promise may reject before the user requests get_done().
 // Suppress process-level unhandled rejection while retaining its rejection.
 done.catch(()=>{});
 const clear=()=>{if(deadline!==undefined){clearTimeout(deadline);deadline=undefined}};
 const arm=()=>{if(finished)return;clear();deadline=setTimeout(()=>fatal(Error("isolated actor Worker deadline exceeded")),timeoutMs)};
 const cleanup=(guestQuiesced=false)=>{
  clear();
  for(const [kind,cb] of [["message",onMessage],["error",onError],["messageerror",onError],["exit",onExit]])
   try{worker.removeEventListener(kind,cb)}catch{}
  let termination;
  try{termination=worker.terminate()}
  catch(error){return Promise.reject(error)}
  const release=()=>{
   if(actorKey!==undefined&&activeIncarnations.get(actorKey)===incarnation)
    activeIncarnations.delete(actorKey);
  };
  // Node worker_threads returns a completion Promise. Browser Workers return
  // void from terminate(): that alone does not prove the old guest exited.
  // Only an exact, validated STOPPED receipt after teardown proves quiescence
  // for the synchronous actor protocol in a non-awaitable Worker adapter.
  if(termination&&typeof termination.then==="function")
   return Promise.resolve(termination).then(release);
  if(actorKey!==undefined&&!guestQuiesced)
   return Promise.reject(Error("nonawaitable Worker termination did not confirm actor retirement"));
  release();
  return Promise.resolve();
 };
 const complete=(error,notifySupervisor=true,guestQuiesced=false)=>{
  if(finished)return;
  finished=true;sealed=true;terminalError=error||null;
  // Cancel every pending serializer immediately; no rejected actor may leave
  // unresolved admission futures waiting on untrusted crypto providers.
  for(const item of queue){
   item.abort?.(error||Error("actor stopped"));
   scrubOwned(item.frame);
   item.frame=null;
  }
  queue.length=0;
  // The active frame belongs to this mailbox until an internal delivery
  // receipt; cancellation/panic must scrub it, too.
  scrubOwned(active?.frame);
  active=null;pending=0;
  cleanup(guestQuiesced).then(()=>{
   if(error){
    if(notifySupervisor)try{onSupervisorPanic?.({type:"ACTOR_TRANSPORT_FAILURE",reason:String(error.message||error)})}catch{}
    doneReject(error);
   }else doneResolve();
  },terminationError=>{
   const failure=Error("actor carrier termination unconfirmed", {cause:terminationError});
   if(notifySupervisor)try{onSupervisorPanic?.({type:"ACTOR_TRANSPORT_FAILURE",reason:failure.message})}catch{}
   doneReject(failure);
  });
 };
 const fatal=error=>complete(error instanceof Error?error:Error("isolated actor Worker failed"));
 const onError=()=>fatal(Error("isolated actor Worker failed"));
 // A native worker_threads adapter may surface exit without first delivering
 // an error event. Browser Workers do not standardize "exit"; registration
 // is optional there, but supported native adapters fail promptly.
 const onExit=()=>fatal(Error("isolated actor Worker exited unexpectedly"));
 // Synchronous Worker adapters may deliver a receipt directly inside
 // postMessage(). Trampoline the next mailbox turn rather than recursively
 // entering pump() for every message (a capacity-sized stack overflow).
 function pump(){
  if(pumping){repump=true;return}
  pumping=true;
  try{
   do{
    repump=false;
    if(finished||!ready||active!==null)break;
    if(queue.length){
     // Sends reserve FIFO tickets before hashing. A later completed digest
     // must not overtake an earlier pending admission.
     if(queue[0].frame===null)break;
     const item=queue.shift();active=item;
     item.dispatched=true;
     try{
      worker.postMessage({kind:"oreslang-v2-data",id:item.id,frame:item.frame,
       ...(incarnation===null?{}:{incarnation})});
      if(active===item&&!finished)arm();
     }catch{fatal(Error("actor DATA transport failure"))}
    }else if(sealed&&pending===0&&!stopping){
     stopping=true;
     try{
      worker.postMessage({kind:"oreslang-v2-control",action:"drain",
       ...(incarnation===null?{}:{incarnation})});
      if(!finished)arm();
     }catch{fatal(Error("actor CONTROL transport failure"))}
    }
   }while(repump&&!finished);
  }finally{pumping=false}
 }
 const onMessage=event=>{
  if(finished)return;
  try {
   const m=event?.data;
  if(!m||typeof m!=="object")return fatal(Error("invalid actor worker message"));
  if(incarnation!==null&&m.incarnation!==incarnation)
   return fatal(Error("stale or forged actor incarnation response"));
  if(m.kind==="oreslang-v2-panic")
   return fatal(Error("isolated actor Worker reported panic"));
  if(m.kind==="oreslang-v2-ready"&&!ready&&!stopping){ready=true;clear();pump();return}
  if(m.kind==="oreslang-v2-receipt"&&ready&&active!==null&&
    m.id===active.id&&m.ok===true){
   clear();
   // Worker postMessage uses structured clone (no transfer list). The host
   // must not retain a second copy of a processed DATA frame.
   scrubOwned(active.frame);
   active.frame=null;active=null;pending--;pump();return
  }
  if(m.kind==="oreslang-v2-stopped"&&stopping&&active===null&&pending===0){
   complete(null,true,true);return
  }
  fatal(Error("invalid actor worker lifecycle or receipt"));
  } catch {
   // Even synthetic or malformed Worker accessors must terminate the
   // carrier, not escape as an uncaught event and strand get_done().
   fatal(Error("invalid actor worker message"));
  }
 };
 try{
  worker.addEventListener("message",onMessage);
  worker.addEventListener("error",onError);
  worker.addEventListener("messageerror",onError);
  try{worker.addEventListener("exit",onExit)}catch{}
  try{
   worker.postMessage({kind:"oreslang-v2-init",schemaId,descriptor,
    ...(guestBytes===null?{}:{incarnation,
     guest:{wasmBytes:guestBytes,manifest:guest.manifest}})});
  }finally{scrubOwned(guestBytes)}
  if(!ready&&!finished)arm();
 }catch{
  // Even a partially registered custom Worker adapter must never leak its
  // carrier thread after failing initialization.
  fatal(Error("actor Worker initialization failed"));
 }
 return Object.freeze({
  async send(value){
   if(sealed||finished)fail("mailbox closed");
   // Budget pessimistically reserves the whole maximum encoded frame BEFORE
   // hashing, including the active turn and every queued/preparing message.
   // Bounded-count mailboxes alone allow capacity * 1MiB memory exhaustion.
   if(pending>=capacity||(pending+1)*maxFrameBytes>maxReservedBytes)
    fail("mailbox full (count or reserved byte budget)");
   pending++;
   const item={id:++seq,frame:null,abort:null,dispatched:false};
   queue.push(item);
   let timer;
   const cancelled=new Promise((_,reject)=>{item.abort=reject});
   try{
    const admissionDeadline=new Promise((_,reject)=>{
     timer=setTimeout(()=>{
      const err=Error("actor DATA admission deadline exceeded");
      fatal(err);reject(err);
     },timeoutMs);
    });
    // The encode promise can finish after stop() already rejected the
    // admission race. Scrub that late owned frame rather than abandoning it.
    const encoding=encodeActorMessageV2({schemaId,descriptor,value,maxBytes:maxFrameBytes})
     .then(frame=>{if(finished)scrubOwned(frame);return frame});
    const frame=await Promise.race([encoding,cancelled,admissionDeadline]);
    if(finished)fail("actor stopped during message admission");
    item.frame=frame;
    pump();
    // A synchronously acknowledging Worker may complete drain() inside
    // pump(). This DATA was already admitted and delivered; only terminal
    // transport failure (or failure to dispatch) invalidates admission.
    if(finished&&(terminalError||!item.dispatched))
     fail("worker rejected message admission");
    return true; // admitted, not necessarily processed
   }catch(error){
    if(!finished){
     pending--;const pos=queue.indexOf(item);if(pos>=0)queue.splice(pos,1);
     scrubOwned(item.frame);item.frame=null;
    }
    pump();throw error
   }finally{
    clearTimeout(timer);item.abort=null;
   }
  },
  drain(){sealed=true;pump();return done},
  stop(){complete(Error("actor cancelled"),false);return done},
  get_done(){return done},
  get pending(){return pending},
  get sealed(){return sealed}
 });
}
