import test from "node:test";
import assert from "node:assert/strict";
import {createActorMessageTransport} from "../src/actor-transport.mjs";

const spec={schemaId:"example.Counter#variant=1",descriptor:"I"};
const guest=()=>({wasmBytes:Uint8Array.from([0,97,115,109,1,0,0,0]),manifest:{}});
const tick=()=>new Promise(resolve=>setImmediate(resolve));

function adapter({forge=false}={}){
 let message,release;
 const terminated=new Promise(resolve=>{release=resolve});
 const worker={
  addEventListener(kind,fn){if(kind==="message")message=fn},
  removeEventListener(){},
  postMessage(data){
   if(data.kind==="oreslang-v2-init")
    queueMicrotask(()=>message({data:{kind:"oreslang-v2-ready",
     incarnation:forge?"f".repeat(32):data.incarnation}}));
   else if(data.kind==="oreslang-v2-control")
    queueMicrotask(()=>message({data:{kind:"oreslang-v2-stopped",incarnation:data.incarnation}}));
  },
  terminate(){return terminated}
 };
 return {worker,release};
}

test("actor key remains fenced until actual carrier termination resolves",async()=>{
 const a=adapter();
 const identity="counter/restart-lease-gate";
 const first=createActorMessageTransport({...spec,guest:guest(),
  actorKey:identity,workerFactory:()=>a.worker});
 await tick();
 const drained=first.drain();
 await tick();
 assert.throws(()=>createActorMessageTransport({...spec,guest:guest(),
  actorKey:identity,workerFactory:()=>{throw Error("should not allocate")}}),
  /incarnation still active or termination unconfirmed/);
 a.release();
 await drained;
 const b=adapter();
 const second=createActorMessageTransport({...spec,guest:guest(),
  actorKey:identity,workerFactory:()=>b.worker});
 await tick();
 const end=second.drain();
 await tick();
 b.release();
 await end;
});

test("stale incarnation READY cannot establish a guest actor",async()=>{
 const fake=adapter({forge:true});
 const a=createActorMessageTransport({...spec,guest:guest(),actorKey:"counter/stale-ready",
  workerFactory:()=>fake.worker});
 await tick();
 const completed=a.get_done();
 const held=createActorMessageTransport;
 assert.throws(()=>held({...spec,guest:guest(),actorKey:"counter/stale-ready",
  workerFactory:()=>{throw Error("must not allocate")}}),/incarnation still active/);
 fake.release();
 await assert.rejects(completed,/stale or forged actor incarnation response/);
});

test("compiled actor identity is mandatory and invalid key rejected before Worker allocation",()=>{
 let created=0;
 for(const actorKey of [undefined,"", "x".repeat(129), "../bad?"]) {
  assert.throws(()=>createActorMessageTransport({...spec,guest:guest(),actorKey,
   workerFactory:()=>{created++;throw Error("worker unexpectedly allocated")}}),
   /requires stable bounded actorKey/);
 }
 assert.equal(created,0);
});
