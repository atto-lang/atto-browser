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


test("sparse contract variants, fields and enum alternatives fail before schema hashing",async()=>{
 const normal={id:1,name:"Compute",fields:[{name:"n",type:"i64"}]};
 const variants=[normal];variants.length=2;
 const badVariants={schemaVersion:1,ownership:"copy",variants};
 await assert.rejects(encodeMessage(badVariants,{variant:"Compute",fields:{n:1n}}),/sparse contract variants/);
 await assert.rejects(decodeMessage(badVariants,Uint8Array.of(0)),/sparse contract variants/);
 const fields=[{name:"n",type:"i64"}];fields.length=2;
 const badFields={schemaVersion:1,ownership:"copy",variants:[{...normal,fields}]};
 await assert.rejects(encodeMessage(badFields,{variant:"Compute",fields:{n:1n}}),/sparse variant fields/);
 const alts=[{id:1,name:"None",payload:null}];alts.length=2;
 const badEnum={schemaVersion:1,ownership:"copy",variants:[{id:1,name:"Compute",fields:[{name:"state",type:{enum:alts}}]}]};
 await assert.rejects(encodeMessage(badEnum,{variant:"Compute",fields:{state:{variant:"None",value:null}}}),/sparse enum alternatives/);
});

test("schema arrays cannot hide custom map methods or accessor elements",async()=>{
 const variants=[{id:1,name:"Compute",fields:[]}];
 variants.map=()=>[];
 const spoof={schemaVersion:1,ownership:"copy",variants};
 await assert.rejects(encodeMessage(spoof,{variant:"Compute",fields:{}}),/noncanonical contract variants/);
 const fields=[{name:"n",type:"i64"}];
 Object.defineProperty(fields,"0",{get(){throw Error("getter invoked")},enumerable:true,configurable:true});
 const accessor={schemaVersion:1,ownership:"copy",variants:[{id:1,name:"Compute",fields}]};
 await assert.rejects(encodeMessage(accessor,{variant:"Compute",fields:{n:1n}}),/accessor variant fields/);
});


test("schema getters and toJSON hooks fail before Worker creation without executing callbacks",()=>{
 let invoked=0,spawned=0;
 const factory=()=>{spawned++;return actualNodeWorker()};
 const getter={...schema};
 Object.defineProperty(getter,"variants",{enumerable:true,get(){invoked++;return schema.variants}});
 assert.throws(()=>createOwnedActorWorker({schema:getter,workerFactory:factory}),/invalid schema admission/);
 const hook={...schema,toJSON(){invoked++;return schema}};
 assert.throws(()=>createOwnedActorWorker({schema:hook,workerFactory:factory}),/invalid schema admission/);
 const accessorField={name:"n"};
 Object.defineProperty(accessorField,"type",{enumerable:true,get(){invoked++;return "i64"}});
 const nested={...schema,variants:[{id:1,name:"Compute",fields:[accessorField]}]};
 assert.throws(()=>createOwnedActorWorker({schema:nested,workerFactory:factory}),/invalid schema admission/);
 assert.equal(invoked,0);
 assert.equal(spawned,0);
});
test("owned envelope rejects accessor-backed payload fields and prototype fields",async()=>{
 let invoked=0;
 const message={variant:"Compute",fields:{text:"safe"}};
 Object.defineProperty(message.fields,"n",{enumerable:true,get(){invoked++;return 4n}});
 await assert.rejects(encodeMessage(schema,message),/invalid message fields shape/);
 assert.equal(invoked,0);
 const inherited=Object.create({text:"inherited",n:4n});
 await assert.rejects(encodeMessage(schema,{variant:"Compute",fields:inherited}),/invalid message fields shape/);
});


test("codec checks payload array descriptors before invoking any getter",async()=>{
 let calls=0;
 const payloadSchema={schemaVersion:1,ownership:"copy",variants:[{id:1,name:"Compute",fields:[{name:"items",type:{tuple:["i64","i64"]}}]}]};
 const items=[1n,2n];
 Object.defineProperty(items,"1",{configurable:true,enumerable:true,get(){calls++;throw Error("getter executed")}});
 await assert.rejects(encodeMessage(payloadSchema,{variant:"Compute",fields:{items}}),/accessor tuple element/);
 const listSchema={schemaVersion:1,ownership:"copy",variants:[{id:1,name:"Compute",fields:[{name:"items",type:{list:{element:"i64",maxLength:4}}}]}]};
 await assert.rejects(encodeMessage(listSchema,{variant:"Compute",fields:{items}}),/accessor array.list element/);
 const fixedSchema={schemaVersion:1,ownership:"copy",variants:[{id:1,name:"Compute",fields:[{name:"items",type:{array:{element:"i64",length:2}}}]}]};
 await assert.rejects(encodeMessage(fixedSchema,{variant:"Compute",fields:{items}}),/accessor array.list element/);
 assert.equal(calls,0);
});

test("codec rejects oversize ArrayBuffer and view before allocation/hash work",async()=>{
 const over=new ArrayBuffer(1048577);
 const arrayView=new Uint8Array(over);
 const dataView=new DataView(over);
 for(const source of [over,arrayView,dataView])
  await assert.rejects(decodeMessage(schema,source,{maxBytes:1048576}),/invalid message size/);
 const tiny=new ArrayBuffer(43);
 await assert.rejects(decodeMessage(schema,tiny),/invalid message size/);
});


test("host rejects request variant getter without executing it or reserving capacity",async()=>{
 let onMessage,invocations=0,requests=0;
 const fake=()=>({
  addEventListener(k,cb){if(k==="message")onMessage=cb},
  removeEventListener(){},
  postMessage(msg){
   if(msg.kind==="oreslang-owned-actor-init-v1")
    queueMicrotask(()=>onMessage({data:{kind:"oreslang-owned-actor-ready-v1",ok:true}}));
   if(msg.kind==="oreslang-owned-actor-request-v1")requests++;
  },
  terminate(){}
 });
 const actor=await createOwnedActorWorker({schema,workerFactory:fake,timeoutMs:500});
 try{
  const hostile={fields:{text:"oops",n:1n}};
  Object.defineProperty(hostile,"variant",{enumerable:true,get(){invocations++;return "Compute"}});
  await assert.rejects(actor.request(hostile),/unadmitted actor Worker request variant/);
  assert.equal(invocations,0);
  assert.equal(actor.pending,0);
  assert.equal(requests,0);
 }finally{actor.close()}
});


test("owned bytes ignore caller iterator, length and buffer getters",async()=>{
 let invoked=0;
 const original=new Uint8Array([7,8,9]);
 Object.defineProperty(original,Symbol.iterator,{configurable:true,value(){invoked++;throw Error("poison iterator")}});
 Object.defineProperty(original,"byteLength",{configurable:true,get(){invoked++;throw Error("poison length")}});
 Object.defineProperty(original,"buffer",{configurable:true,get(){invoked++;throw Error("poison buffer")}});
 const contract={schemaVersion:1,ownership:"copy",variants:[{id:1,name:"Compute",fields:[{name:"payload",type:"bytes"}]}]};
 const encoded=await encodeMessage(contract,{variant:"Compute",fields:{payload:original}});
 const roundtrip=await decodeMessage(contract,encoded);
 assert.deepEqual([...roundtrip.fields.payload],[7,8,9]);
 assert.equal(invoked,0);
});


test("decode snapshots hostile buffer views using intrinsic byte slots",async()=>{
 let accesses=0;
 const wire=await encodeMessage(schema,compute("hostile-view",12));
 const sources=[new Uint8Array(wire),new DataView(wire.buffer.slice(0)),wire.buffer.slice(0)];
 for(const input of sources){
  for(const key of ["byteLength","buffer","byteOffset"]){
   Object.defineProperty(input,key,{configurable:true,get(){accesses++;throw Error("shadowed "+key)}});
  }
  const value=await decodeMessage(schema,input);
  assert.deepEqual(value,compute("hostile-view",12));
 }
 assert.equal(accesses,0);
});
