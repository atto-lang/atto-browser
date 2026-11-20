import test from 'node:test';
import assert from 'node:assert/strict';
import {Buffer} from 'node:buffer';
import {inspectWasmBytes} from '../src/inspect.mjs';

const core=[0,97,115,109,1,0,0,0];

test('Buffer subarrays use native byte offsets rather than pooled backing starts',()=>{
 const parent=Buffer.from([254,253,252,251,...core,250,249]);
 const child=parent.subarray(4,12);
 const admitted=inspectWasmBytes(child,{maxModuleBytes:8});
 assert.deepEqual([...admitted.bytes],core);
 parent[5]=0;
 assert.equal(admitted.bytes[1],97);
});

test('Buffer view user properties cannot override native byte budget and snapshot',()=>{
 const view=Buffer.from(core);
 let invoked=0;
 for(const property of ['buffer','byteOffset','byteLength'])
  Object.defineProperty(view,property,{get(){invoked++;throw Error('poisoned slot');}});
 Object.defineProperty(view,Symbol.iterator,{get(){invoked++;throw Error('poisoned iterator');}});
 assert.deepEqual([...inspectWasmBytes(view,{maxModuleBytes:8}).bytes],core);
 assert.equal(invoked,0);
});

test('Buffer-backed SharedArrayBuffer views remain denied even with forged public backing',()=>{
 if(typeof SharedArrayBuffer!=='function')return;
 const shared=new SharedArrayBuffer(16);
 const view=Buffer.from(shared,4,8);
 view.set(core);
 Object.defineProperty(view,'buffer',{value:new ArrayBuffer(8)});
 assert.throws(()=>inspectWasmBytes(view,{maxModuleBytes:8}),/shared Wasm input memory is not admitted/);
});
