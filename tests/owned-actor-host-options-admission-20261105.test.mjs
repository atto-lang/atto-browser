import test from "node:test";
import assert from "node:assert/strict";
import {createOwnedActorWorker} from "../src/owned-actor-host.mjs";

const schema={schemaVersion:1,ownership:"copy",variants:[
 {id:1,name:"Compute",fields:[{name:"text",type:"string"},{name:"n",type:"i64"}]},
 {id:2,name:"Result",fields:[{name:"text",type:"string"},{name:"n",type:"i64"}]}
]};
test("actor worker options cannot run getters before isolated carrier admission",()=>{
 let called=0,started=0;
 for(const field of ["schema","workerFactory","maxPending","maxBytes","timeoutMs"]){
  const opts={schema,workerFactory:()=>{started++;return {};},timeoutMs:5000};
  Object.defineProperty(opts,field,{enumerable:true,get(){called++;return field==="maxPending"?1:5000;}});
  assert.throws(()=>createOwnedActorWorker(opts),/own data fields/);
 }
 assert.equal(called,0);
 assert.equal(started,0);
});
test("plain own worker options preserve readiness and close without privileged aliases",async()=>{
 let onMessage,terminated=0;
 const actor=await createOwnedActorWorker({
  schema,maxPending:2,timeoutMs:1000,
  workerFactory:()=>({
   addEventListener(kind,cb){if(kind==="message")onMessage=cb;},
   removeEventListener(){},
   postMessage(data){
    if(data.kind==="oreslang-owned-actor-init-v1")
     queueMicrotask(()=>onMessage({data:{kind:"oreslang-owned-actor-ready-v1",ok:true}}));
   },
   terminate(){terminated++;return Promise.resolve(0);}
  })
 });
 assert.equal(actor.pending,0);
 actor.close();
 assert.equal(terminated,1);
 const bogus={schema};bogus[Symbol("admin")]=true;
 assert.throws(()=>createOwnedActorWorker(bogus),/unknown Worker option/);
 assert.throws(()=>createOwnedActorWorker(Object.create({schema})),/invalid Worker options/);
});
