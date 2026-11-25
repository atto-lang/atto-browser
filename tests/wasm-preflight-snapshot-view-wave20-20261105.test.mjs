import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectWasmBytes as inspect} from '../src/inspect.mjs';

const header=Uint8Array.of(0,97,115,109,1,0,0,0);
const bounded=Uint8Array.from([...header,5,4,1,1,1,2]);

test('bare valid header passes at the byte budget and leaves independent owned bytes',()=>{
  const input=Uint8Array.from(header);
  const result=inspect(input,{maxModuleBytes:8,maxMemoryPages:1});
  assert.deepEqual([...result.bytes],[...header]);
  assert.notStrictEqual(result.bytes,input);
  input.fill(0);
  assert.deepEqual([...result.bytes],[...header]);
  assert.equal(result.memoryCount,0);
});

test('DataView native slots cannot be replaced by caller getters or iterators',()=>{
  const container=Uint8Array.from([77,...bounded,88]);
  const view=new DataView(container.buffer,1,bounded.length);
  let called=0;
  for(const name of ['buffer','byteOffset','byteLength']){
    Object.defineProperty(view,name,{get(){called++;throw Error('untrusted getter');}});
  }
  Object.defineProperty(view,Symbol.iterator,{get(){called++;throw Error('iterator');}});
  const result=inspect(view,{maxModuleBytes:64,maxMemoryPages:2});
  assert.equal(result.memoryCount,1);
  assert.equal(result.memoryMaximum,2);
  container.fill(0);
  assert.deepEqual([...result.bytes],[...bounded]);
  assert.equal(called,0);
});

test('memory maxima and fixed-bound requirement are checked before acceptance',()=>{
  assert.throws(()=>inspect(bounded,{maxModuleBytes:64,maxMemoryPages:1}),/linear memory exceeds host budget/);
  const badFlags=Uint8Array.from([...header,5,4,1,3,1,2]);
  assert.throws(()=>inspect(badFlags,{maxModuleBytes:64}),/memory requires fixed initial and maximum limits/);
  assert.throws(()=>inspect(bounded,{maxModuleBytes:12}),/exceeds maximum byte size/);
});

test('truncated varints, forbidden sections and precompiled modules fail closed',()=>{
  for(const bytes of [Uint8Array.from([...header,5,0x80]),
                      Uint8Array.from([...header,8,1,0]),
                      Uint8Array.from([...header,4,0])]){
    assert.throws(()=>inspect(bytes,{maxModuleBytes:64}),/Wasm admission denied/);
  }
  assert.throws(()=>inspect(new WebAssembly.Module(header)),/precompiled WebAssembly.Module/);
});
