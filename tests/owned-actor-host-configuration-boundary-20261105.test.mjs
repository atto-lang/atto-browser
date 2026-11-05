import test from 'node:test';
import assert from 'node:assert/strict';
import {createOwnedActorWorker} from '../src/owned-actor-host.mjs';

const schema={schemaVersion:1,ownership:'copy',variants:[
 {id:1,name:'Compute',fields:[{name:'text',type:'string'},{name:'n',type:'i64'}]},
 {id:2,name:'Result',fields:[{name:'text',type:'string'},{name:'n',type:'i64'}]}
]};

test('resource-limit denial happens before creating any dedicated Worker',()=>{
 let factories=0;
 const workerFactory=()=>{factories++;throw Error('must not spawn');};
 for(const patch of [
  {maxPending:0},{maxPending:257},{maxPending:1.5},
  {maxBytes:43},{maxBytes:1048577},{maxBytes:Infinity},
  {timeoutMs:0},{timeoutMs:30001},{timeoutMs:1.5}
 ]){
  assert.throws(()=>createOwnedActorWorker({schema,workerFactory,...patch}),/invalid/);
 }
 assert.equal(factories,0);
});

test('invalid owned contract cannot allocate an untrusted Worker',()=>{
 let factories=0;
 const workerFactory=()=>{factories++;throw Error('must not spawn');};
 assert.throws(()=>createOwnedActorWorker({schema:null,workerFactory}),/invalid schema admission/);
 assert.equal(factories,0);
});

test('structurally invalid Worker adapter is refused after schema admission',async()=>{
 let factories=0;
 await assert.rejects(createOwnedActorWorker({
  schema,workerFactory:()=>{factories++;return {addEventListener(){},postMessage(){}};},
  maxPending:1,timeoutMs:25,maxBytes:44
 }),/Worker factory required/);
 assert.equal(factories,1);
});
