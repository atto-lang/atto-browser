import test from "node:test";
import assert from "node:assert/strict";
import {runVerifiedCoreGuestInWorker} from "../src/worker-host.mjs";

const moduleBytes=Uint8Array.from([0,97,115,109,1,0,0,0]);
function workerFor(reply){
  const listeners=new Map();
  let terminations=0;
  return {
    get terminations(){return terminations;},
    get listeners(){return listeners;},
    factory:()=>({
      addEventListener(k,cb){listeners.set(k,cb);},
      removeEventListener(k){listeners.delete(k);},
      postMessage(){
        queueMicrotask(()=>listeners.get("message")?.(reply()));
      },
      terminate(){terminations++;}
    })
  };
}
function poisoned(property){
 const message={kind:"oreslang-core-result-v1",ok:true,value:"42"};
 if(property==="event"){
   return Object.defineProperty({}, "data", {get(){throw Error("untrusted event accessor");}});
 }
 return {data:Object.defineProperty(message,property,{
   get(){throw Error("untrusted "+property+" accessor");}
 })};
}

test("throwing Worker event getters reject and terminate without uncaught callbacks",async()=>{
 for(const property of ["event","kind","ok","value"]){
   const worker=workerFor(()=>poisoned(property));
   await assert.rejects(runVerifiedCoreGuestInWorker({
     wasmBytes:moduleBytes,manifest:{},workerFactory:worker.factory,timeoutMs:1000
   }),/invalid isolated Wasm worker response/,property);
   assert.equal(worker.terminations,1,property);
   assert.equal(worker.listeners.size,0,property);
 }
});

test("normal scalar result still settles exactly once",async()=>{
 const worker=workerFor(()=>({data:{
   kind:"oreslang-core-result-v1",ok:true,value:"42"
 }}));
 const result=await runVerifiedCoreGuestInWorker({
   wasmBytes:moduleBytes,manifest:{},workerFactory:worker.factory,timeoutMs:1000
 });
 assert.equal(result,42n);
 assert.equal(worker.terminations,1);
 assert.equal(worker.listeners.size,0);
});
