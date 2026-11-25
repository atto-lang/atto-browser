import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectWasmBytes} from '../src/inspect.mjs';

const H=[0,97,115,109,1,0,0,0];
const memory=max=>Uint8Array.from([...H,5,max<128?4:5,1,1,1,...(max<128?[max]:[max&127|128,max>>7])]);

test('genuine fixed-memory core module at exact 256-page policy ceiling is admitted',()=>{
 const bytes=memory(256);
 assert.equal(WebAssembly.validate(bytes),true);
 const info=inspectWasmBytes(bytes,{maxModuleBytes:64,maxMemoryPages:256});
 assert.equal(info.memoryCount,1);
 assert.equal(info.memoryInitial,1);
 assert.equal(info.memoryMaximum,256);
 assert.equal(info.hasMemoryMaximum,true);
 assert.deepEqual([...info.bytes],[...bytes]);
});

test('valid Wasm with 257-page maximum cannot exceed admission ceiling',()=>{
 const bytes=memory(257);
 assert.equal(WebAssembly.validate(bytes),true);
 assert.throws(()=>inspectWasmBytes(bytes,{maxModuleBytes:64,maxMemoryPages:256}),/linear memory exceeds host budget/);
 assert.throws(()=>inspectWasmBytes(memory(256),{maxModuleBytes:64,maxMemoryPages:32}),/linear memory exceeds host budget/);
});

test('unknown and shared memory flags are denied independently of size budget',()=>{
 for(const flags of [0,2,3,4]){
  const bytes=Uint8Array.from([...H,5,4,1,flags,1,1]);
  assert.throws(()=>inspectWasmBytes(bytes,{maxModuleBytes:64,maxMemoryPages:256}),/memory requires fixed initial and maximum limits/);
 }
});