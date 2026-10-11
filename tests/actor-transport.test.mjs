import test from "node:test";
import assert from "node:assert/strict";
import {Worker} from "node:worker_threads";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {createActorMessageTransport} from "../src/actor-transport.mjs";
const spec={schemaId:"example.Compute#variant=1",descriptor:"T[S,I]"};
function workerFactory(){
 const worker=new Worker(new URL("./fixtures/actor-node-worker-shim.mjs",import.meta.url),{type:"module"});
 const map=new Map();
 return {
  addEventListener(kind,cb){const handler=kind==="message"?data=>cb({data}):()=>cb({});map.set(cb,{kind,handler});worker.on(kind,handler)},
  removeEventListener(kind,cb){const v=map.get(cb);if(v){worker.off(v.kind,v.handler);map.delete(cb)}},
  postMessage(data){worker.postMessage(data)},
  terminate(){return worker.terminate()}
 };
}
test("browser codec is byte-identical to canonical upstream Wasm codec",async()=>{
 const b=await readFile(new URL("../src/messagepack-v2.mjs",import.meta.url));
 const header=Buffer.from("blob "+b.length+"\0","utf8");
 assert.equal(createHash("sha1").update(header).update(b).digest("hex"),
  "82bf858cfff6d2be79333047ed3733a14b1d634c");
});
test("isolated Worker processes bounded canonical actor DATA; drain seals mailbox",async()=>{
 const actor=createActorMessageTransport({...spec,workerFactory,capacity:3});
 assert.equal(await actor.send(["hello",42n]),true);
 assert.equal(await actor.send(["second",-(1n<<63n)]),true);
 const drained=actor.drain();
 await assert.rejects(actor.send(["late",1n]),/mailbox closed/);
 await drained;
 assert.equal(actor.pending,0);
 assert.equal(actor.sealed,true);
 await actor.get_done();
});
test("mailbox reserves full capacity before async hashing and rejects overload",async()=>{
 const worker=()=>({addEventListener(){},removeEventListener(){},postMessage(){},terminate(){}});
 const a=createActorMessageTransport({...spec,workerFactory:worker,capacity:1,timeoutMs:500});
 const first=a.send(["first",1n]);
 await assert.rejects(a.send(["too many",2n]),/mailbox full/);
 await first; // admission can succeed before runtime has acknowledged readiness
 await assert.rejects(a.stop(),/cancelled/);
 assert.equal(a.sealed,true);
});
test("malformed data is denied before admission without leaking queue capacity",async()=>{
 const a=createActorMessageTransport({...spec,workerFactory,capacity:1});
 await assert.rejects(a.send(["wrong",5]),/BigInt/);
 assert.equal(a.pending,0);
 assert.equal(await a.send(["valid",5n]),true);
 await a.drain();
});
test("forged worker receipt triggers supervisor CONTROL failure",async()=>{
 let cb,reported=0,terminated=false;
 const workerFactory=()=>({
  addEventListener(kind,fn){if(kind==="message")cb=fn},
  removeEventListener(){},
  postMessage(msg){if(msg.kind==="oreslang-v2-init")queueMicrotask(()=>cb({data:{kind:"oreslang-v2-ready"}}));
   if(msg.kind==="oreslang-v2-data")queueMicrotask(()=>cb({data:{kind:"oreslang-v2-receipt",id:99999,ok:true}}))},
  terminate(){terminated=true}
 });
 const a=createActorMessageTransport({...spec,workerFactory,onSupervisorPanic(){reported++}});
 assert.equal(await a.send(["hello",1n]),true);
 await assert.rejects(a.get_done(),/invalid actor worker lifecycle/);
 assert.equal(reported,1);
 assert.equal(terminated,true);
});
