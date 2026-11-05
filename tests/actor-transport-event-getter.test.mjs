import test from "node:test";
import assert from "node:assert/strict";
import {createActorMessageTransport} from "../src/actor-transport.mjs";

const spec={schemaId:"example.Guest#variant=1",descriptor:"I"};
function makeActor(){
 let listener,terminated=0;
 const reports=[];
 const actor=createActorMessageTransport({...spec,timeoutMs:1000,
  workerFactory:()=>({
   addEventListener(name,cb){if(name==="message")listener=cb;},
   removeEventListener(){},
   postMessage(){},
   terminate(){terminated++;return Promise.resolve(0);}
  }),
  onSupervisorPanic:reason=>reports.push(reason)
 });
 return {actor,deliver:event=>listener(event),
   get terminated(){return terminated},reports};
}

test("throwing actor Worker event accessors fail closed without stranding completion",async()=>{
 for(const kind of ["event","kind","receipt"]){
  const f=makeActor();
  const data={kind:"oreslang-v2-receipt",id:1,ok:true};
  const event=kind==="event"
   ?Object.defineProperty({},"data",{get(){throw Error("poisoned data");}})
   :{data:Object.defineProperty(data,kind==="receipt"?"ok":"kind",{
       get(){throw Error("poisoned reply field");}
     })};
  assert.doesNotThrow(()=>f.deliver(event));
  await assert.rejects(f.actor.get_done(),/invalid actor worker message/);
  assert.equal(f.terminated,1);
  assert.equal(f.reports.length,1);
 }
});

test("valid actor READY and STOPPED messages still retire successfully",async()=>{
 let receive,terminated=0;
 const actor=createActorMessageTransport({...spec,timeoutMs:1000,
   workerFactory:()=>({
    addEventListener(k,cb){if(k==="message")receive=cb;},
    removeEventListener(){},
    postMessage(m){
     if(m.kind==="oreslang-v2-init")
       queueMicrotask(()=>receive({data:{kind:"oreslang-v2-ready"}}));
     if(m.kind==="oreslang-v2-control")
       queueMicrotask(()=>receive({data:{kind:"oreslang-v2-stopped"}}));
    },
    terminate(){terminated++;return Promise.resolve(0);}
   })
 });
 await actor.drain();
 await actor.get_done();
 assert.equal(terminated,1);
});
