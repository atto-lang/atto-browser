import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {Worker} from "node:worker_threads";
import {encodeActorMessageV2} from "../src/messagepack-v2.mjs";
import {createActorMessageTransport} from "../src/actor-transport.mjs";

const wasmPath=process.env.ORE_REAL_ACTOR_WASM;
const manifestPath=process.env.ORE_REAL_ACTOR_MANIFEST;
if(process.env.ORE_REQUIRE_REAL_ACTOR==="1"&&(!wasmPath||!manifestPath))
 throw Error("required compiler-generated actor Worker evidence is unconfigured");
const spec={schemaId:"example.Counter#variant=1",descriptor:"I"};
const workerUrl=new URL("./fixtures/actor-node-worker-shim.mjs",import.meta.url);

async function guest(){
 return {wasmBytes:await readFile(wasmPath),
  manifest:JSON.parse(await readFile(manifestPath,"utf8"))};
}
function exchange(worker,data){
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{clear();reject(Error("compiled actor Worker response timeout"))},4000);
  const onMessage=x=>{clear();resolve(x)};
  const onError=e=>{clear();reject(e)};
  function clear(){
   clearTimeout(timer);worker.off("message",onMessage);worker.off("error",onError);
  }
  worker.on("message",onMessage);worker.on("error",onError);
  worker.postMessage(data);
 });
}
const dataFrame=value=>encodeActorMessageV2({...spec,value});

test("real .ores source actor executes typed DATA in isolated Worker, preserves state and drains",{
 skip:!wasmPath||!manifestPath
},async()=>{
 const w=new Worker(workerUrl,{type:"module"});
 try{
  assert.deepEqual(await exchange(w,{kind:"oreslang-v2-init",...spec,guest:await guest()}),
   {kind:"oreslang-v2-ready"});
  for(const [id,value,result] of [[1,2n,12n],[2,3n,15n],[4,1n,16n]]){
   assert.deepEqual(await exchange(w,{kind:"oreslang-v2-data",id,frame:await dataFrame(value)}),
    {kind:"oreslang-v2-receipt",id,ok:true,result});
  }
  assert.deepEqual(await exchange(w,{kind:"oreslang-v2-control",action:"drain"}),
   {kind:"oreslang-v2-stopped"});
 }finally{await w.terminate()}
 const second=new Worker(workerUrl,{type:"module"});
 try{
  assert.equal((await exchange(second,{kind:"oreslang-v2-init",...spec,guest:await guest()})).kind,
   "oreslang-v2-ready");
  assert.deepEqual(await exchange(second,{kind:"oreslang-v2-data",id:1,frame:await dataFrame(1n)}),
   {kind:"oreslang-v2-receipt",id:1,ok:true,result:11n});
 }finally{await second.terminate()}
});

test("tampered compiled actor binary is rejected before Ready or DATA receipt",{
 skip:!wasmPath||!manifestPath
},async()=>{
 const w=new Worker(workerUrl,{type:"module"});
 try{
  const g=await guest();
  g.wasmBytes=Uint8Array.from(g.wasmBytes);
  g.wasmBytes[g.wasmBytes.length-1]^=1;
  assert.deepEqual(await exchange(w,{kind:"oreslang-v2-init",...spec,guest:g}),
   {kind:"oreslang-v2-panic"});
 }finally{await w.terminate()}
});

test("bounded host transport admits the real Wasm actor without changing original caller bytes",{
 skip:!wasmPath||!manifestPath
},async()=>{
 const g=await guest(),original=Uint8Array.from(g.wasmBytes);
 function factory(){
  const raw=new Worker(workerUrl,{type:"module"});
  const handlers=new Map();
  return {
   addEventListener(kind,fn){
    const callback=kind==="message"?data=>fn({data}):()=>fn({});
    handlers.set(fn,{kind,callback});raw.on(kind,callback);
   },
   removeEventListener(_kind,fn){
    const record=handlers.get(fn);
    if(record){raw.off(record.kind,record.callback);handlers.delete(fn)}
   },
   postMessage(message){raw.postMessage(message)},
   terminate(){return raw.terminate()}
  };
 }
 const actor=createActorMessageTransport({...spec,workerFactory:factory,guest:g});
 assert.equal(await actor.send(2n),true);
 assert.equal(await actor.send(3n),true);
 await actor.drain();
 assert.deepEqual(Uint8Array.from(g.wasmBytes),original,"caller-owned compiler artifact not mutated");
 assert.equal(actor.pending,0);
});
