import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectWasmBytes} from '../src/inspect.mjs';

const header=[0,97,115,109,1,0,0,0];

test('raw ArrayBuffer reads native length and snapshots without caller accessors',()=>{
  const input=Uint8Array.from(header);
  let invoked=0;
  Object.defineProperty(input.buffer,'byteLength',{get(){invoked++;throw Error('hostile length');}});
  const parsed=inspectWasmBytes(input.buffer,{maxModuleBytes:8});
  assert.equal(invoked,0);
  assert.deepEqual(Array.from(parsed.bytes),header);
  input[1]=0;
  assert.equal(parsed.bytes[1],97,'owned bytes cannot alias the original buffer');
});

test('a SharedArrayBuffer cannot impersonate ArrayBuffer by changing its prototype',()=>{
  if(typeof SharedArrayBuffer!=='function')return;
  const shared=new SharedArrayBuffer(8);
  new Uint8Array(shared).set(header);
  Object.setPrototypeOf(shared,ArrayBuffer.prototype);
  assert.throws(()=>inspectWasmBytes(shared,{maxModuleBytes:8}),
    /expected a Wasm ArrayBuffer or typed array|shared Wasm input memory is not admitted/);
});

test('browser loader refuses precompiled modules without original inspectable bytes',()=>{
  const compiled=new WebAssembly.Module(Uint8Array.from(header));
  assert.throws(()=>inspectWasmBytes(compiled),/precompiled WebAssembly.Module cannot be inspected/);
});
