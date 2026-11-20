import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectWasmBytes} from '../src/inspect.mjs';

const empty=[0,97,115,109,1,0,0,0];
const fixed=[...empty,5,4,1,1,1,1];

test('native typed-view slots copy exact byte slice without invoking poisoned own properties',()=>{
 const full=new Uint8Array(32);full.set(fixed,5);
 const view=full.subarray(5,5+fixed.length);
 let calls=0;
 Object.defineProperty(view,Symbol.iterator,{get(){calls++;throw Error('poisoned iterator')}});
 Object.defineProperty(view,'buffer',{get(){calls++;throw Error('poisoned buffer')}});
 const result=inspectWasmBytes(view,{maxModuleBytes:fixed.length,maxMemoryPages:1});
 assert.equal(calls,0);
 assert.deepEqual([...result.bytes],fixed);
 assert.equal(result.memoryCount,1);
 assert.equal(result.memoryMaximum,1);
 full[5]=255;
 assert.equal(result.bytes[0],0);
});

test('DataView offset admits a valid empty header without trusting own byte-length getters',()=>{
 const storage=Uint8Array.from([7,...empty,9]);
 const view=new DataView(storage.buffer,1,8);
 let calls=0;
 Object.defineProperty(view,'byteLength',{get(){calls++;throw Error('poisoned size')}});
 const result=inspectWasmBytes(view,{maxModuleBytes:8,maxMemoryPages:1});
 assert.deepEqual([...result.bytes],empty);
 assert.equal(result.memoryCount,0);
 assert.equal(calls,0);
});

test('invalid module-size and memory-page admission budgets fail before parsing',()=>{
 const bytes=Uint8Array.from(empty);
 for(const maxModuleBytes of [0,7,1.5,16*1024*1024+1])
  assert.throws(()=>inspectWasmBytes(bytes,{maxModuleBytes}),/invalid maximum module size/);
 for(const maxMemoryPages of [0,-1,257,1.5])
  assert.throws(()=>inspectWasmBytes(bytes,{maxMemoryPages}),/invalid maximum memory pages/);
 assert.throws(()=>inspectWasmBytes(Uint8Array.from(empty.slice(0,7))),/invalid core module header/);
});
