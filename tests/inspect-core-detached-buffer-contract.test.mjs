import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectWasmBytes} from '../src/inspect.mjs';

const header=[0,97,115,109,1,0,0,0];

test('a detached ArrayBuffer cannot be treated as valid original Wasm bytes',()=>{
 const original=Uint8Array.from(header).buffer;
 structuredClone(original,{transfer:[original]});
 assert.throws(()=>inspectWasmBytes(original,{maxModuleBytes:8}));
});

test('detached typed array and DataView inputs fail closed',()=>{
 for(const kind of ['typed','data']){
  const original=Uint8Array.from(header);
  const input=kind==='typed'?original:new DataView(original.buffer);
  structuredClone(original.buffer,{transfer:[original.buffer]});
  assert.throws(()=>inspectWasmBytes(input,{maxModuleBytes:8}),undefined,kind);
 }
});

test('successful snapshots are immutable to later detach or caller mutation',()=>{
 const original=Uint8Array.from(header);
 const admitted=inspectWasmBytes(original,{maxModuleBytes:8});
 structuredClone(original.buffer,{transfer:[original.buffer]});
 assert.deepEqual([...admitted.bytes],header);
 assert.equal(WebAssembly.validate(admitted.bytes),true);
});
