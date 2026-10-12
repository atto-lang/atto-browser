/**
 * Experimental isolated host for a JS reference actor speaking ORM1.
 * The guest Worker is real, but the handler is not Oreslang-compiled code.
 * Every request crosses the Worker boundary as an owned typed envelope.
 */
import {encodeMessage,decodeMessage} from "./owned-message/owned-envelope.mjs";

const fail=reason=>{throw new TypeError("Oreslang owned actor Worker: "+reason)};
export function createOwnedActorWorker({
 schema,workerFactory,maxPending=16,maxBytes=1048576,timeoutMs=5000
}={}){
 if(!Number.isSafeInteger(maxPending)||maxPending<1||maxPending>256)fail("invalid maxPending");
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)fail("invalid timeout");
 if(!Number.isSafeInteger(maxBytes)||maxBytes<44||maxBytes>1048576)fail("invalid maxBytes");
 let snapped;
 try{snapped=JSON.parse(JSON.stringify(schema));}catch{fail("invalid schema serialization")}
 if(!snapped||typeof snapped!=="object"||Array.isArray(snapped))fail("invalid schema");
 const make=workerFactory||(()=>{
  if(typeof Worker!=="function")fail("Web Worker unavailable");
  return new Worker(new URL("./owned-actor-worker.mjs",import.meta.url),{type:"module"});
 });
 let worker,ready=false,closed=false,nextId=1,transmit=Promise.resolve();
 const outstanding=new Map();
 let initResolve,initReject,readyTimeout;
 const cancelAll=error=>{
  if(closed)return;
  closed=true;
  clearTimeout(readyTimeout);
  if(worker){
   for(const [kind,callback] of [["message",onMessage],["error",onError],
                                  ["messageerror",onError]]){
    try{worker.removeEventListener(kind,callback)}catch{}
   }
   try{const t=worker.terminate();if(t?.catch)t.catch(()=>{});}catch{}
  }
  for(const pending of outstanding.values()){
   clearTimeout(pending.timer);
   pending.reject(error);
  }
  outstanding.clear();
  if(!ready)initReject(error);
 };
 const onError=()=>cancelAll(new Error("isolated actor Worker failed"));
 const onMessage=event=>{
  const data=event?.data;
  if(!ready){
   if(data?.kind==="oreslang-owned-actor-ready-v1"&&data.ok===true){
    ready=true;clearTimeout(readyTimeout);
    initResolve(Object.freeze({
     request,
     close:()=>cancelAll(new Error("actor closed")),
     get pending(){return outstanding.size}
    }));
   }else cancelAll(new Error("invalid actor Worker admission"));
   return;
  }
  if(data?.kind!=="oreslang-owned-actor-reply-v1"||
     !Number.isSafeInteger(data.id)||data.id<1||
     typeof data.ok!=="boolean"||!outstanding.has(data.id)){
   cancelAll(new Error("invalid actor Worker response"));
   return;
  }
  const entry=outstanding.get(data.id);
  // Correlation alone is insufficient: a reserved but never published ID
  // cannot be completed by an unsolicited early Worker event.
  if(!entry.sent){
   cancelAll(new Error("reply before actor Worker request publication"));
   return;
  }
  if(entry.verifying){
   cancelAll(new Error("duplicate actor Worker response"));
   return;
  }
  entry.verifying=true;
  if(!data.ok){
   outstanding.delete(data.id);clearTimeout(entry.timer);
   entry.reject(new Error("actor delivery rejected"));
   return;
  }
  // A response remains pending until the owned bytes have been verified and
  // decoded. close() or deadline during WebCrypto validation must still win.
  Promise.resolve().then(()=>decodeMessage(snapped,data.bytes,{maxBytes})).then(
   reply=>{
    if(closed)return;
    // A valid ORM1 envelope may still carry the wrong language-level type.
    // This isolated reference Worker only permits Compute -> Result.
    if(reply.variant!=="Result"){
     cancelAll(new Error("unadmitted actor Worker reply variant"));
     return;
    }
    outstanding.delete(data.id);clearTimeout(entry.timer);entry.resolve(reply);
   },
   ()=>{
    if(closed)return;
    cancelAll(new Error("invalid owned actor reply envelope"));
   }
  );
 };
 const request=async(message)=>{
  if(closed)throw Error("actor closed");
  if(!ready)throw Error("actor not ready");
  // Reference Worker supports Compute requests only. Fail before consuming an
  // ID, allocating a deadline or sending an unadmitted variant to the Worker.
  if(message?.variant!=="Compute")throw Error("unadmitted actor Worker request variant");
  if(outstanding.size>=maxPending)throw Error("actor Worker pending limit exceeded");
  if(nextId>Number.MAX_SAFE_INTEGER)throw Error("actor request ID exhausted");
  const id=nextId++;
  // Reserve capacity synchronously, before any WebCrypto await.
  let resolve,reject;
  const result=new Promise((yes,no)=>{resolve=yes;reject=no});
  // close() can reject this reserved promise before the async encoder has
  // posted it and before request() returns it. Observe it immediately to
  // avoid a transient unhandled rejection; callers still receive rejection.
  result.catch(()=>{});
  // The deadline covers encoding, FIFO admission and the Worker response.
  // A blocked WebCrypto digest must not keep a reserved slot forever.
  const entry={resolve,reject,timer:setTimeout(
   ()=>cancelAll(new Error("actor Worker deadline exceeded")),timeoutMs)};
  outstanding.set(id,entry);
  // Serialize immediately so a caller mutation after request() cannot
  // change payload bytes. Then preserve admission order across asynchronous
  // WebCrypto SHA-256 work: the Worker requires strictly increasing IDs.
  const encoded=encodeMessage(snapped,message,{maxBytes});
  encoded.catch(()=>{});
  const posted=transmit.then(async()=>{
   const bytes=await encoded;
   if(closed)throw Error("actor closed");
   // Mark as published before postMessage: a synchronous test shim may send
   // its response reentrantly while postMessage is still on the stack.
   entry.sent=true;
   // No transfer list: ownership is copied across the isolated Worker.
   worker.postMessage({kind:"oreslang-owned-actor-request-v1",id,bytes,maxBytes});
  });
  transmit=posted.catch(()=>{});
  // Return the reserved result immediately: waiting on posted would defeat
  // the admission deadline if async hashing or queued admission stalls.
  posted.catch(error=>{
   if(closed)return; // cancelAll already rejected every reserved promise.
   clearTimeout(entry.timer);
   outstanding.delete(id);
   entry.reject(error);
  });
  return result;
 };
 return new Promise((resolve,reject)=>{
  initResolve=resolve;initReject=reject;
  try{
   worker=make();
   if(!worker||typeof worker.addEventListener!=="function"||
      typeof worker.removeEventListener!=="function"||
      typeof worker.postMessage!=="function"||
      typeof worker.terminate!=="function")fail("isolated Worker factory required");
   worker.addEventListener("message",onMessage);
   worker.addEventListener("error",onError);
   worker.addEventListener("messageerror",onError);
   readyTimeout=setTimeout(()=>cancelAll(new Error("actor Worker admission timeout")),timeoutMs);
   worker.postMessage({kind:"oreslang-owned-actor-init-v1",schema:snapped,
    maxPending,maxBytes});
  }catch(error){cancelAll(error)}
 });
}
