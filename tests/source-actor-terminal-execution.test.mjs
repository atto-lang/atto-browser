import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {encodeActorMessageV2} from "../src/messagepack-v2.mjs";

// An ACK fence alone does not establish actor single-turn safety: an
// asynchronous digest can finish AFTER a terminal replay panic. Instrument
// a REAL compiled source actor export and prove it was never invoked.
const wasmPath=process.env.ORE_REAL_ACTOR_WASM;
const manifestPath=process.env.ORE_REAL_ACTOR_MANIFEST;
if(process.env.ORE_REQUIRE_REAL_ACTOR==="1"&&(!wasmPath||!manifestPath))
 throw Error("required compiled source actor fixture is unavailable");
const schemaId="example.Counter#variant=1",descriptor="I";
const incarnation="b".repeat(32),tag=x=>({...x,incarnation});

test("terminal replay during digest prevents ALL subsequent compiled actor execution",{
 skip:!wasmPath||!manifestPath
},async()=>{
 const bytes=await readFile(wasmPath);
 const manifest=JSON.parse(await readFile(manifestPath,"utf8"));
 const frame=await encodeActorMessageV2({schemaId,descriptor,value:5n});
 const originalSelf=Object.getOwnPropertyDescriptor(globalThis,"self");
 const originalCrypto=Object.getOwnPropertyDescriptor(globalThis,"crypto");
 const originalWasm=Object.getOwnPropertyDescriptor(globalThis,"WebAssembly");
 const realWasm=globalThis.WebAssembly;
 const realDigest=globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
 const sent=[];
 let listener,turns=0,holdDigest=false,releaseDigest;
 let resolveEntered;
 const entered=new Promise(resolve=>{resolveEntered=resolve});
 try{
  Object.defineProperty(globalThis,"self",{configurable:true,value:{
   addEventListener(kind,fn){if(kind==="message")listener=fn},
   postMessage(value){sent.push(value)}
  }});
  Object.defineProperty(globalThis,"crypto",{configurable:true,value:{subtle:{
   digest(algorithm,input){
    if(!holdDigest)return realDigest(algorithm,input);
    return new Promise((resolve,reject)=>{
     releaseDigest=()=>realDigest(algorithm,input).then(resolve,reject);
     resolveEntered();
    });
   }
  }}});
  const wasm=Object.create(realWasm);
  wasm.instantiate=async (...args)=>{
   const instance=await realWasm.instantiate(...args);
   const init=instance.exports[manifest.actor.init];
   const handle=instance.exports[manifest.actor.onMessage];
   const teardown=instance.exports[manifest.actor.teardown];
   // Keep original compiled Wasm functions, just instrument their entry.
   // An ordinary object avoids Proxy invariants on Wasm export objects.
   return {exports:{
    [manifest.actor.init]:()=>init(),
    [manifest.actor.onMessage]:(value)=>{turns++;return handle(value)},
    [manifest.actor.teardown]:()=>teardown()
   }};
  };
  Object.defineProperty(globalThis,"WebAssembly",{configurable:true,value:wasm});
  await import("../src/actor-message-worker.mjs?terminal-execution-fence=1");
  await listener({data:{kind:"oreslang-v2-init",schemaId,descriptor,
   guest:{wasmBytes:bytes,manifest},incarnation}});
  assert.deepEqual(sent,[tag({kind:"oreslang-v2-ready"})]);
  holdDigest=true;
  const input=Uint8Array.from(frame);
  const pending=listener({data:{kind:"oreslang-v2-data",id:1,frame:input,incarnation}});
  await entered;
  const rejected=Uint8Array.from(frame);
  await listener({data:{kind:"oreslang-v2-data",id:2,frame:rejected,incarnation}});
  assert.deepEqual(sent,[tag({kind:"oreslang-v2-ready"}),tag({kind:"oreslang-v2-panic"})]);
  assert.equal(turns,0);
  releaseDigest();
  await pending;
  assert.equal(turns,0,"terminated actor was executed after async decode resumed");
  assert.deepEqual(sent,[tag({kind:"oreslang-v2-ready"}),tag({kind:"oreslang-v2-panic"})],
   "terminal actor must not acknowledge the in-flight DATA");
  assert.ok(input.every(x=>x===0));
  assert.ok(rejected.every(x=>x===0));
 }finally{
  for(const [name,descriptor] of [
   ["self",originalSelf],["crypto",originalCrypto],["WebAssembly",originalWasm]
  ]){
   if(descriptor)Object.defineProperty(globalThis,name,descriptor);
   else delete globalThis[name];
  }
 }
});
