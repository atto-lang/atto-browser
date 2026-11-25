import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectWasmBytes} from '../src/inspect.mjs';

const header=[0,97,115,109,1,0,0,0];

test('DataView native byteOffset and byteLength prevent spoofed slice promotion',()=>{
 const backing=Uint8Array.from([255,254,253,...header,252,251]);
 const view=new DataView(backing.buffer,3,8);
 let accessed=0;
 for(const property of ['buffer','byteOffset','byteLength'])
  Object.defineProperty(view,property,{get(){accessed++;throw Error('poisoned '+property);}});
 const got=inspectWasmBytes(view,{maxModuleBytes:8});
 assert.equal(accessed,0);
 assert.deepEqual([...got.bytes],header);
 backing[4]=0;
 assert.equal(got.bytes[1],97,'admitted bytes do not alias source');
});

test('DataView of shared backing is rejected before copying or parsing',()=>{
 if(typeof SharedArrayBuffer!=='function')return;
 const shared=new SharedArrayBuffer(8);
 new Uint8Array(shared).set(header);
 assert.throws(()=>inspectWasmBytes(new DataView(shared),{maxModuleBytes:8}),/shared Wasm input memory is not admitted/);
});

test('wrong DataView offset cannot be rescued by forged getters',()=>{
 const backing=Uint8Array.from([255,...header]);
 const bad=new DataView(backing.buffer,0,8);
 Object.defineProperty(bad,'byteOffset',{get(){return 1;}});
 assert.throws(()=>inspectWasmBytes(bad,{maxModuleBytes:8}),/invalid core module header/);
});
