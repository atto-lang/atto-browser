import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectWasmBytes} from '../src/inspect.mjs';

const header=[0,97,115,109,1,0,0,0];
const wasm=section=>Uint8Array.from([...header,...section]);

test('fixed linear-memory limits respect the browser host budget',()=>{
  const fixed=wasm([5,4,1,1,2,2]);
  assert.equal(WebAssembly.validate(fixed),true);
  const result=inspectWasmBytes(fixed,{maxModuleBytes:64,maxMemoryPages:2});
  assert.equal(result.memoryCount,1);
  assert.equal(result.memoryInitial,2);
  assert.equal(result.memoryMaximum,2);
  assert.equal(result.hasMemoryMaximum,true);
  assert.throws(()=>inspectWasmBytes(fixed,{maxModuleBytes:64,maxMemoryPages:1}),
                /linear memory exceeds host budget/);
  const withoutMaximum=wasm([5,3,1,0,2]);
  assert.equal(WebAssembly.validate(withoutMaximum),true);
  assert.throws(()=>inspectWasmBytes(withoutMaximum,{maxModuleBytes:64}),
                /memory requires fixed initial and maximum limits/);
});

test('unexpected active start and table sections cannot bypass preflight',()=>{
  assert.throws(()=>inspectWasmBytes(wasm([8,1,0]),{maxModuleBytes:64}),
                /start section is forbidden/);
  assert.throws(()=>inspectWasmBytes(wasm([4,1,0]),{maxModuleBytes:64}),
                /table section is not yet admitted/);
});
