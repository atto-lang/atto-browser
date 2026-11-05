import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectWasmBytes} from '../src/inspect.mjs';

const fixed=Uint8Array.from([0,97,115,109,1,0,0,0,5,4,1,1,2,2]);

test('poisoned DataView own getters never change fixed-memory admission',()=>{
 assert.equal(WebAssembly.validate(fixed),true);
 const padded=Uint8Array.from([255,...fixed,254]);
 const view=new DataView(padded.buffer,1,fixed.length);
 let reads=0;
 for(const name of ['buffer','byteOffset','byteLength'])
  Object.defineProperty(view,name,{get(){reads++;throw Error('hostile getter');}});
 const result=inspectWasmBytes(view,{maxModuleBytes:fixed.length,maxMemoryPages:2});
 assert.equal(result.memoryCount,1);assert.equal(result.memoryMaximum,2);
 assert.deepEqual([...result.bytes],[...fixed]);
 padded[2]=0;
 assert.equal(result.bytes[1],97);assert.equal(reads,0);
});
test('fixed memory page maxima remain separate from module-byte budget',()=>{
 assert.throws(()=>inspectWasmBytes(fixed,{maxModuleBytes:64,maxMemoryPages:1}),
  /linear memory exceeds host budget/);
 const result=inspectWasmBytes(fixed,{maxModuleBytes:64,maxMemoryPages:2});
 assert.equal(result.memoryInitial,2);assert.equal(result.memoryMaximum,2);
});
test('missing maximum and inverted min/max are never admitted',()=>{
 const unbounded=Uint8Array.from([0,97,115,109,1,0,0,0,5,3,1,0,2]);
 const inverted=Uint8Array.from([0,97,115,109,1,0,0,0,5,4,1,1,2,1]);
 assert.throws(()=>inspectWasmBytes(unbounded,{maxModuleBytes:64}),
  /memory requires fixed initial and maximum limits/);
 assert.throws(()=>inspectWasmBytes(inverted,{maxModuleBytes:64}),
  /linear memory exceeds host budget/);
});
test('compiled Wasm modules and spoofed view lengths cannot bypass admission',()=>{
 assert.throws(()=>inspectWasmBytes(new WebAssembly.Module(fixed)),
  /precompiled WebAssembly.Module cannot be inspected/);
 const input=fixed.slice();let calls=0;
 Object.defineProperty(input,'byteLength',{get(){calls++;throw Error('fake extent');}});
 assert.equal(inspectWasmBytes(input,{maxModuleBytes:64}).bytes.length,fixed.length);
 assert.equal(calls,0);
});
