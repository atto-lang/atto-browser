// Host-side Wasm byte admission, not a guest run or sandbox proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectWasmBytes} from '../src/inspect.mjs';

const header=[0,97,115,109,1,0,0,0];
const moduleBytes=section=>Uint8Array.from([...header,...section]);
const memory=body=>moduleBytes([5,body.length,...body]);

test('single bounded memory is decoded before the native Wasm validation gate',()=>{
 const one=memory([1,1,1,1]);
 const result=inspectWasmBytes(one,{maxMemoryPages:1,maxModuleBytes:64});
 assert.equal(result.memoryCount,1);
 assert.equal(result.hasMemoryMaximum,true);
 assert.equal(result.memoryInitial,1);
 assert.equal(result.memoryMaximum,1);
 assert.deepEqual(Array.from(result.bytes),Array.from(one));
});

test('multi-memory, memory64 and shared declarations fail before instantiation',()=>{
 for(const body of [[2,1,1,1,1,1,1],[1,3,1,1],[1,5,1,1],
                     [1,1,2,1],[1,1,1,33]]){
  assert.throws(()=>inspectWasmBytes(memory(body),{maxMemoryPages:32,maxModuleBytes:64}));
 }
 assert.throws(()=>inspectWasmBytes(moduleBytes([8,0]),{maxModuleBytes:64}),/start section is forbidden/);
 assert.throws(()=>inspectWasmBytes(moduleBytes([4,0]),{maxModuleBytes:64}),/table section is not yet admitted/);
});

test('bounded parser denies truncated section bodies and varuint overflow',()=>{
 for(const tail of [[5,4,1,1,1],[5,0x80],[5,0xff,0xff,0xff,0xff,0x10],
                    [5,1,0x80]]){
  assert.throws(()=>inspectWasmBytes(moduleBytes(tail),{maxModuleBytes:64}));
 }
});

test('DataView aliases use native view slots and return detached owned byte copies',()=>{
 const backing=Uint8Array.from([77,...header,88]);
 const view=new DataView(backing.buffer,1,8);
 let calls=0;
 for(const field of ['buffer','byteOffset','byteLength'])
  Object.defineProperty(view,field,{get(){calls++;throw Error('untrusted slot');}});
 Object.defineProperty(view,Symbol.iterator,{get(){calls++;throw Error('untrusted iterator');}});
 const result=inspectWasmBytes(view,{maxModuleBytes:8,maxMemoryPages:1});
 assert.deepEqual(Array.from(result.bytes),header);
 backing.fill(0);
 assert.deepEqual(Array.from(result.bytes),header);
 assert.equal(calls,0);
});
