// Host-owned synthetic Worker replies only; not AttoLang guest execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {runVerifiedCoreGuestInWorker} from '../src/worker-host.mjs';

const wasm=Uint8Array.from([0,97,115,109,1,0,0,0]);
const valid={kind:'oreslang-core-result-v1',ok:true,value:'42'};
function fakeWorker(reply) {
  const listeners=new Map();
  let terminated=0;
  return {
    get terminated(){return terminated;},
    get listenerCount(){return listeners.size;},
    factory:()=>({
      addEventListener(kind,listener){listeners.set(kind,listener);},
      removeEventListener(kind){listeners.delete(kind);},
      postMessage(){queueMicrotask(()=>listeners.get('message')?.({data:reply()}));},
      terminate(){terminated++;}
    })
  };
}
async function runWith(reply) {
  const fake=fakeWorker(reply);
  const promise=runVerifiedCoreGuestInWorker({
    wasmBytes:wasm,manifest:{},workerFactory:fake.factory,timeoutMs:1000
  });
  return {promise,fake};
}
test('inherited success fields never authorize a Worker response',async()=>{
  for(const key of ['kind','ok','value']) {
    const own={...valid};
    delete own[key];
    const message=Object.assign(Object.create({[key]:valid[key]}),own);
    const {promise,fake}=await runWith(()=>message);
    await assert.rejects(promise,/invalid isolated Wasm worker response/,key);
    assert.equal(fake.terminated,1,key);
    assert.equal(fake.listenerCount,0,key);
  }
});
test('nonthrowing reply accessors are rejected without invoking getters',async()=>{
  for(const key of ['kind','ok','value']) {
    let calls=0;
    const message={...valid};
    Object.defineProperty(message,key,{enumerable:true,get(){
      calls++;
      return valid[key];
    }});
    const {promise,fake}=await runWith(()=>message);
    await assert.rejects(promise,/invalid isolated Wasm worker response/,key);
    assert.equal(calls,0,key);
    assert.equal(fake.terminated,1,key);
    assert.equal(fake.listenerCount,0,key);
  }
});
test('own success and explicit Worker rejection retain distinct outcomes',async()=>{
  const success=await runWith(()=>({...valid}));
  assert.equal(await success.promise,42n);
  assert.equal(success.fake.terminated,1);
  assert.equal(success.fake.listenerCount,0);
  const rejection=await runWith(()=>({
    kind:'oreslang-core-result-v1',ok:false,code:'guest-run-failed'
  }));
  await assert.rejects(rejection.promise,/execution rejected/);
  assert.equal(rejection.fake.terminated,1);
  assert.equal(rejection.fake.listenerCount,0);
});
