import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectWasmBytes} from '../src/inspect.mjs';

const header=[0,97,115,109,1,0,0,0];
const core=(...tail)=>Uint8Array.from([...header,...tail]);

test('browser source parser admits consecutive inert custom sections without memory',()=>{
 const bytes=core(0,1,0,0,1,0);
 assert.equal(WebAssembly.validate(bytes),true);
 const parsed=inspectWasmBytes(bytes,{maxModuleBytes:bytes.length});
 assert.equal(parsed.memoryCount,0);
 assert.deepEqual([...parsed.bytes],[...bytes]);
});

test('browser section admission rejects truncated and overflowing length encodings',()=>{
 for(const [payload,expected] of [
  [[0,0x80],/truncated unsigned integer/],
  [[0,5,0],/section extends beyond module/],
  [[0,0xff,0xff,0xff,0xff,0x10],/invalid u32 encoding/]
 ])assert.throws(()=>inspectWasmBytes(core(...payload),{maxModuleBytes:64}),expected);
});

test('browser module byte ceiling includes custom-section framing',()=>{
 const bytes=core(0,1,0);
 assert.equal(inspectWasmBytes(bytes,{maxModuleBytes:bytes.length}).bytes.length,bytes.length);
 assert.throws(()=>inspectWasmBytes(bytes,{maxModuleBytes:bytes.length-1}),/Wasm module exceeds maximum byte size/);
});
