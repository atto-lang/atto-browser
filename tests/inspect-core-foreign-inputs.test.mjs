import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectWasmBytes} from '../src/inspect.mjs';

const header=[0,97,115,109,1,0,0,0];

test('browser loader does not accept foreign JSON arrays or precompiled modules',()=>{
 for(const candidate of [undefined,null,0,false,'wasm',header,{}])
  assert.throws(()=>inspectWasmBytes(candidate),/expected a Wasm ArrayBuffer or typed array/);
 const compiled=new WebAssembly.Module(Uint8Array.from(header));
 assert.throws(()=>inspectWasmBytes(compiled),/precompiled WebAssembly.Module cannot be inspected/);
});

test('hostile ArrayBuffer length getter is bypassed and output owns its bytes',()=>{
 const view=Uint8Array.from(header);
 let calls=0;
 Object.defineProperty(view.buffer,'byteLength',{get(){calls++;throw Error('spoof');}});
 const result=inspectWasmBytes(view.buffer,{maxModuleBytes:8});
 assert.equal(calls,0);
 assert.deepEqual([...result.bytes],header);
 view[1]=0;
 assert.equal(result.bytes[1],97);
});

test('forged SharedArrayBuffer prototype is not mistaken for a private ArrayBuffer',()=>{
 if(typeof SharedArrayBuffer!=='function')return;
 const shared=new SharedArrayBuffer(8);
 new Uint8Array(shared).set(header);
 Object.setPrototypeOf(shared,ArrayBuffer.prototype);
 assert.throws(()=>inspectWasmBytes(shared,{maxModuleBytes:8}),/expected a Wasm ArrayBuffer or typed array|shared Wasm input memory is not admitted/);
});
