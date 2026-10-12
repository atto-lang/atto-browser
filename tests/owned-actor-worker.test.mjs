import test from "node:test";
import assert from "node:assert/strict";
import {Worker} from "node:worker_threads";
import {createOwnedActorWorker} from "../src/owned-actor-host.mjs";
import {encodeMessage,decodeMessage} from "../src/owned-message/owned-envelope.mjs";

const schema={schemaVersion:1,ownership:"copy",variants:[
 {id:1,name:"Compute",fields:[{name:"text",type:"string"},{name:"n",type:"i64"}]},
 {id:2,name:"Result",fields:[{name:"text",type:"string"},{name:"n",type:"i64"}]}
]};
const compute=(text,n)=>({variant:"Compute",fields:{text,n:BigInt(n)}});
const result=(text,n)=>({variant:"Result",fields:{text,n:BigInt(n)}});
function actualNodeWorker(){
 const worker=new Worker(new URL("./fixtures/node-owned-actor-shim.mjs",import.meta.url),
  {type:"module",execArgv:[]});
 const handlers=new Map();
 return {
  addEventListener(kind,callback){
   const handle=kind==="message"?data=>callback({data}):()=>callback({});
   handlers.set(callback,{kind,handle});worker.on(kind,handle);
  },
  removeEventListener(kind,callback){
   const rec=handlers.get(callback);
   if(rec){worker.off(rec.kind,rec.handle);handlers.delete(callback)}
  },
  postMessage(data){worker.postMessage(data)},
  terminate(){return worker.terminate()}
 };
}
test("real isolated Worker executes 32 serial typed Compute -> Result round trips",async()=>{
 const actor=await createOwnedActorWorker({
  schema,workerFactory:actualNodeWorker,maxPending:64,timeoutMs:10000
 });
 try{
  const replies=await Promise.all(Array.from({length:32},(_,i)=>actor.request(compute("work"+i,i))));
  assert.deepEqual(replies,Array.from({length:32},(_,i)=>result("work"+i,i+1)));
  assert.equal(actor.pending,0);
 }finally{actor.close()}
});
test("concurrent caller mutations do not replace queued Worker message bytes",async()=>{
 const actor=await createOwnedActorWorker({
  schema,workerFactory:actualNodeWorker,timeoutMs:10000
 });
 try{
  const input=compute("before",41);
  const pending=actor.request(input);
  input.fields.text="after";input.fields.n=999n;
  assert.deepEqual(await pending,result("before",42));
 }finally{actor.close()}
});
test("unadmitted Compute/Result schema fails before actor Worker readiness",async()=>{
 const invalid={...schema,variants:[schema.variants[0]]};
 await assert.rejects(createOwnedActorWorker({
  schema:invalid,workerFactory:actualNodeWorker,timeoutMs:10000
 }),/invalid actor Worker admission/);
});
test("pending ceiling rejects overflow while preserving existing request",async()=>{
 let onMessage,terminated=0;
 const fake=()=>({
  addEventListener(k,cb){if(k==="message")onMessage=cb},
  removeEventListener(){},
  postMessage(msg){
   if(msg.kind==="oreslang-owned-actor-init-v1")
    queueMicrotask(()=>onMessage({data:{kind:"oreslang-owned-actor-ready-v1",ok:true}}));
  },
  terminate(){terminated++}
 });
 const actor=await createOwnedActorWorker({schema,workerFactory:fake,maxPending:1,timeoutMs:1000});
 const first=actor.request(compute("first",1));first.catch(()=>{});
 await assert.rejects(actor.request(compute("second",2)),/pending limit exceeded/);
 actor.close();
 await assert.rejects(first,/actor closed/);
 assert.equal(terminated,1);
});
test("unresponsive worker deadline terminates actor and rejects pending requests",async()=>{
 let onMessage,terminated=0;
 const fake=()=>({
  addEventListener(k,cb){if(k==="message")onMessage=cb},
  removeEventListener(){},
  postMessage(msg){
   if(msg.kind==="oreslang-owned-actor-init-v1")
    queueMicrotask(()=>onMessage({data:{kind:"oreslang-owned-actor-ready-v1",ok:true}}));
  },
  terminate(){terminated++}
 });
 const actor=await createOwnedActorWorker({schema,workerFactory:fake,timeoutMs:20});
 await assert.rejects(actor.request(compute("hanging",41)),/deadline exceeded/);
 assert.equal(terminated,1);
 await assert.rejects(actor.request(compute("late",5)),/actor closed/);
});
test("unsolicited reply id fails closed without trusting worker results",async()=>{
 let onMessage,terminated=0;
 const fake=()=>({
  addEventListener(k,cb){if(k==="message")onMessage=cb},
  removeEventListener(){},
  postMessage(msg){
   if(msg.kind==="oreslang-owned-actor-init-v1")
    queueMicrotask(()=>onMessage({data:{kind:"oreslang-owned-actor-ready-v1",ok:true}}));
   if(msg.kind==="oreslang-owned-actor-request-v1")
    queueMicrotask(()=>onMessage({data:{kind:"oreslang-owned-actor-reply-v1",id:9999,ok:true,bytes:msg.bytes}}));
  },
  terminate(){terminated++}
 });
 const actor=await createOwnedActorWorker({schema,workerFactory:fake,timeoutMs:1000});
 await assert.rejects(actor.request(compute("x",1)),/invalid actor Worker response/);
 assert.equal(terminated,1);
});


test("sparse tuple descriptor is rejected before canonical schema hashing",async()=>{
 const holes=new Array(1);
 const schemaWithHole={schemaVersion:1,ownership:"copy",variants:[{
  id:1,name:"Compute",fields:[{name:"items",type:{tuple:holes}}]
 }]};
 await assert.rejects(encodeMessage(schemaWithHole,{variant:"Compute",fields:{items:[[]]}}),/sparse tuple descriptor/);
 await assert.rejects(decodeMessage(schemaWithHole,Uint8Array.of(0)),/sparse tuple descriptor/);
});
test("sparse tuple values cannot suppress zero-byte element accounting",async()=>{
 const s={schemaVersion:1,ownership:"copy",variants:[{
  id:1,name:"Compute",fields:[{name:"items",type:{tuple:[{tuple:[]}]}}]
 }]};
 await assert.rejects(encodeMessage(s,{variant:"Compute",fields:{items:new Array(1)}}),/sparse tuple element/);
 const dense={variant:"Compute",fields:{items:[[]]}};
 assert.deepEqual(await decodeMessage(s,await encodeMessage(s,dense)),dense);
});
test("actor reservation expires even if WebCrypto encoding never settles",{timeout:2000},async()=>{
 let onMessage,terminated=0,requestsPosted=0;
 const fake=()=>({
  addEventListener(k,cb){if(k==="message")onMessage=cb},
  removeEventListener(){},
  postMessage(msg){
   if(msg.kind==="oreslang-owned-actor-init-v1")
    queueMicrotask(()=>onMessage({data:{kind:"oreslang-owned-actor-ready-v1",ok:true}}));
   else requestsPosted++;
  },
  terminate(){terminated++}
 });
 const actor=await createOwnedActorWorker({schema,workerFactory:fake,timeoutMs:25});
 const original=Object.getOwnPropertyDescriptor(globalThis,"crypto");
 try{
  Object.defineProperty(globalThis,"crypto",{configurable:true,value:{subtle:{digest:()=>new Promise(()=>{})}}});
  await assert.rejects(actor.request(compute("stuck",7)),/deadline exceeded/);
  assert.equal(actor.pending,0);
  assert.equal(requestsPosted,0);
  assert.equal(terminated,1);
 }finally{
  if(original)Object.defineProperty(globalThis,"crypto",original);
  else delete globalThis.crypto;
  actor.close();
 }
});


test("a valid envelope with the wrong response variant cannot satisfy a pending Compute reply",async()=>{
 let onMessage,terminated=0;
 const fake=()=>({
  addEventListener(k,cb){if(k==="message")onMessage=cb},
  removeEventListener(){},
  postMessage(msg){
   if(msg.kind==="oreslang-owned-actor-init-v1")
    queueMicrotask(()=>onMessage({data:{kind:"oreslang-owned-actor-ready-v1",ok:true}}));
   if(msg.kind==="oreslang-owned-actor-request-v1")
    queueMicrotask(()=>onMessage({data:{kind:"oreslang-owned-actor-reply-v1",id:msg.id,ok:true,bytes:msg.bytes}}));
  },
  terminate(){terminated++}
 });
 const actor=await createOwnedActorWorker({schema,workerFactory:fake,timeoutMs:1000});
 await assert.rejects(actor.request(compute("wrong-reply",4)),/unadmitted actor Worker reply variant/);
 assert.equal(actor.pending,0);
 assert.equal(terminated,1);
});

test("unadmitted inbound Result never allocates or dispatches an actor request",async()=>{
 let onMessage,requestsPosted=0,terminated=0;
 const fake=()=>({
  addEventListener(k,cb){if(k==="message")onMessage=cb},
  removeEventListener(){},
  postMessage(msg){
   if(msg.kind==="oreslang-owned-actor-init-v1")
    queueMicrotask(()=>onMessage({data:{kind:"oreslang-owned-actor-ready-v1",ok:true}}));
   if(msg.kind==="oreslang-owned-actor-request-v1")requestsPosted++;
  },
  terminate(){terminated++}
 });
 const actor=await createOwnedActorWorker({schema,workerFactory:fake,timeoutMs:1000});
 try{
  await assert.rejects(actor.request(result("not-a-request",1)),/unadmitted actor Worker request variant/);
  assert.equal(actor.pending,0);
  assert.equal(requestsPosted,0);
 }finally{actor.close()}
 assert.equal(terminated,1);
});


test("reserved-but-unpublished request cannot be completed by a guessed Worker response",async()=>{
 let onMessage,terminated=0,posted=0;
 const fake=()=>({
  addEventListener(k,cb){if(k==="message")onMessage=cb},
  removeEventListener(){},
  postMessage(msg){
   if(msg.kind==="oreslang-owned-actor-init-v1")
    queueMicrotask(()=>onMessage({data:{kind:"oreslang-owned-actor-ready-v1",ok:true}}));
   if(msg.kind==="oreslang-owned-actor-request-v1")posted++;
  },
  terminate(){terminated++}
 });
 const actor=await createOwnedActorWorker({schema,workerFactory:fake,timeoutMs:1000});
 const inFlight=actor.request(compute("not-published",1));
 inFlight.catch(()=>{});
 // The reserved ID is predictable but cannot be answered before postMessage.
 onMessage({data:{kind:"oreslang-owned-actor-reply-v1",id:1,ok:false}});
 await assert.rejects(inFlight,/reply before actor Worker request publication/);
 assert.equal(terminated,1);
 assert.equal(actor.pending,0);
 assert.equal(posted,0);
});
