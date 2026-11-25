import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectWasmBytes as inspect} from '../src/inspect.mjs';

const header=[0,97,115,109,1,0,0,0];
const bounded=Uint8Array.from([...header,5,4,1,1,1,2]);

test('memory preflight reports fixed bounds and snapshots only the supplied view',()=>{
  assert.equal(WebAssembly.validate(bounded),true);
  const container=Uint8Array.from([55,...bounded,66]);
  const view=new DataView(container.buffer,1,bounded.length);
  const result=inspect(view,{maxModuleBytes:64,maxMemoryPages:2});
  assert.equal(result.memoryCount,1);
  assert.equal(result.memoryInitial,1);
  assert.equal(result.memoryMaximum,2);
  assert.equal(result.hasMemoryMaximum,true);
  assert.deepEqual([...result.bytes],[...bounded]);
  container[1]=77;
  assert.equal(result.bytes[0],0);
});

test('host budget and unsupported memory flags are denied before module compilation',()=>{
  assert.throws(()=>inspect(bounded,{maxMemoryPages:1}),/linear memory exceeds host budget/);
  assert.throws(()=>inspect(bounded,{maxModuleBytes:12}),/exceeds maximum byte size/);
  const sharedFlags=Uint8Array.from([...header,5,4,1,3,1,2]);
  assert.throws(()=>inspect(sharedFlags),/memory requires fixed initial and maximum limits/);
  const startSection=Uint8Array.from([...header,8,1,0]);
  assert.throws(()=>inspect(startSection),/start section is forbidden/);
});

test('spoofed view properties cannot redirect source bytes; shared backing fails',()=>{
  const native=Uint8Array.from(bounded);
  let getterCalls=0;
  Object.defineProperty(native,'buffer',{get(){getterCalls++;throw Error('buffer getter');}});
  const result=inspect(native,{maxMemoryPages:2});
  assert.equal(result.memoryMaximum,2);
  assert.equal(getterCalls,0);
  if(typeof SharedArrayBuffer==='function'){
    const shared=new Uint8Array(new SharedArrayBuffer(bounded.length));
    shared.set(bounded);
    assert.throws(()=>inspect(shared),/shared Wasm input memory is not admitted/);
  }
});
