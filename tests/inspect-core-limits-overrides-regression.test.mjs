import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectWasmBytes} from '../src/inspect.mjs';

const header=[0,97,115,109,1,0,0,0];

test('invalid browser Wasm budgets are denied before hostile input probes',()=>{
 let traps=0;
 const hostile=new Proxy({},{
  getPrototypeOf(){traps++;throw Error('unexpected input read');},
  get(){traps++;throw Error('unexpected input read');}
 });
 for(const maxModuleBytes of [7,0,-1,16*1024*1024+1,1.25,NaN])
  assert.throws(()=>inspectWasmBytes(hostile,{maxModuleBytes}),/invalid maximum module size/);
 for(const maxMemoryPages of [0,-1,257,1.25,Infinity])
  assert.throws(()=>inspectWasmBytes(hostile,{maxMemoryPages}),/invalid maximum memory pages/);
 assert.equal(traps,0);
});

test('DataView intrinsic slots defeat forged own length and iterator',()=>{
 const bytes=Uint8Array.from([255,...header,255]);
 const view=new DataView(bytes.buffer,1,8);
 let traps=0;
 Object.defineProperty(view,'byteLength',{get(){traps++;throw Error('forged length');}});
 Object.defineProperty(view,Symbol.iterator,{get(){traps++;throw Error('forged iterator');}});
 const result=inspectWasmBytes(view,{maxModuleBytes:8,maxMemoryPages:1});
 assert.deepEqual([...result.bytes],header);
 bytes[1]=0;
 assert.deepEqual([...result.bytes],header,'returned bytes are an owned snapshot');
 assert.equal(traps,0);
});

test('one extra byte fails the strict browser Wasm size limit',()=>{
 assert.throws(()=>inspectWasmBytes(Uint8Array.from([...header,0]),{maxModuleBytes:8}),/Wasm module exceeds maximum byte size/);
});