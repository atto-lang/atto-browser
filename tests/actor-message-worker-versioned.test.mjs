import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {Worker} from "node:worker_threads";
import {encodeActorMessageV2} from "../src/messagepack-v2.mjs";
const leb=x=>{const out=[];do{let b=x&127;x>>>=7;if(x)b|=128;out.push(b)}while(x);return out};
const name=x=>{const b=[...new TextEncoder().encode(x)];return [...leb(b.length),...b]};
const section=(id,body)=>[id,...leb(body.length),...body];
const entry=(n,i)=>[...name(n),0,...leb(i)];
const spec={schemaId:"version.Counter",descriptor:"I"},incarnation="b".repeat(32);
const tag=x=>({...x,incarnation});
function fixture(v2){
 const actor={name:"Counter",init:v2?"oreslang_wasm_actor_init":"oreslang_actor_Counter_init",onMessage:v2?"oreslang_wasm_actor_on_message":"oreslang_actor_Counter_on_message",messageShape:"I",instancesPerActor:1};
 if(v2)Object.assign(actor,{teardown:"oreslang_wasm_actor_teardown",lifecycle:"NEW-ACTIVE-STOPPED"});
 const wasmBytes=Uint8Array.from([0,97,115,109,1,0,0,0,
 ...section(1,[2,0x60,0,0,0x60,1,0x7e,1,0x7e]),
 ...section(3,v2?[3,0,1,0]:[2,0,1]),...section(5,[1,1,2,2]),
 ...section(7,[v2?3:2,...entry(actor.init,0),...entry(actor.onMessage,1),...(v2?entry(actor.teardown,2):[])]),
 ...section(10,v2?[3,2,0,0x0b,4,0,0x20,0,0x0b,2,0,0x0b]:[2,2,0,0x0b,4,0,0x20,0,0x0b])]);
 assert.ok(WebAssembly.validate(wasmBytes));
 return {wasmBytes,manifest:{schemaVersion:1,artifactType:"oreslang.core-wasm.actor-i64-v"+(v2?2:1),target:"wasm32",environment:"browser",imports:[],requiredCapabilities:[],memory:{maximumPages:2},wasmBytes:wasmBytes.length,wasmSha256:createHash("sha256").update(wasmBytes).digest("hex"),entry:actor.onMessage,actor}};
}
function exchange(w,data){return new Promise((resolve,reject)=>{
 const timer=setTimeout(()=>{cleanup();reject(Error("worker timeout"))},4000);
 const message=x=>{cleanup();resolve(x)},error=e=>{cleanup();reject(e)};
 function cleanup(){clearTimeout(timer);w.off("message",message);w.off("error",error)}
 w.on("message",message);w.on("error",error);w.postMessage(data);
})}
for(const v2 of [false,true])test("real synthetic ABI "+(v2?"v2":"v1")+" executes and drains without version aliasing",async()=>{
 const w=new Worker(new URL("./fixtures/actor-node-worker-shim.mjs",import.meta.url),{type:"module"});
 try{
  assert.deepEqual(await exchange(w,{kind:"oreslang-v2-init",...spec,guest:fixture(v2),incarnation}),tag({kind:"oreslang-v2-ready"}));
  const frame=await encodeActorMessageV2({...spec,value:17n});
  assert.deepEqual(await exchange(w,{kind:"oreslang-v2-data",id:1,frame,incarnation}),tag({kind:"oreslang-v2-receipt",id:1,ok:true,result:17n}));
  assert.deepEqual(await exchange(w,{kind:"oreslang-v2-control",action:"drain",incarnation}),tag({kind:"oreslang-v2-stopped"}));
 }finally{await w.terminate()}
 const bad=new Worker(new URL("./fixtures/actor-node-worker-shim.mjs",import.meta.url),{type:"module"});
 try{
  const guest=fixture(v2);guest.manifest.artifactType="oreslang.core-wasm.actor-i64-v"+(v2?1:2);
  assert.deepEqual(await exchange(bad,{kind:"oreslang-v2-init",...spec,guest,incarnation}),tag({kind:"oreslang-v2-panic"}));
 }finally{await bad.terminate()}
});
