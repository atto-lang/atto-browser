import test from "node:test";
import assert from "node:assert/strict";
import {createActorMessageTransport} from "../src/actor-transport.mjs";

const spec={schemaId:"example.Compute#variant=1",descriptor:"I"};
test("poisoned termination then getter cannot escape an actor Worker error callback",async()=>{
 let onError,terminations=0,supervisor=0,reads=0;
 const actor=createActorMessageTransport({...spec,timeoutMs:1000,
  onSupervisorPanic(){supervisor++;},
  workerFactory:()=>({
   addEventListener(type,fn){if(type==="error")onError=fn;},
   removeEventListener(){},postMessage(){},
   terminate(){
    terminations++;
    return Object.defineProperty({},"then",{get(){
     reads++;throw Error("poisoned termination getter");
    }});
   }
  })
 });
 assert.doesNotThrow(()=>onError({}));
 await assert.rejects(actor.get_done(),/actor carrier termination unconfirmed/);
 assert.equal(reads,1);
 assert.equal(terminations,1);
 assert.equal(supervisor,1);
});

test("promise-returning trusted termination still retires a failed actor once",async()=>{
 let onError,terminations=0;
 const actor=createActorMessageTransport({...spec,timeoutMs:1000,
  workerFactory:()=>({
   addEventListener(type,fn){if(type==="error")onError=fn;},
   removeEventListener(){},postMessage(){},
   terminate(){terminations++;return Promise.resolve(0);}
  })
 });
 assert.doesNotThrow(()=>onError({}));
 await assert.rejects(actor.get_done(),/isolated actor Worker failed/);
 assert.equal(terminations,1);
});
