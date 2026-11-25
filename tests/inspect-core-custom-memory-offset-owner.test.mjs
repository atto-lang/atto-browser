import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectWasmBytes} from '../src/inspect.mjs';

const bytes=Uint8Array.from([
 0,97,115,109,1,0,0,0, 0,3,1,97,0, 5,4,1,1,1,1
]);

test('nonzero-offset DataView with custom section and fixed memory is snapshotted',()=>{
 assert.equal(WebAssembly.validate(bytes),true);
 const padded=Buffer.alloc(bytes.length+12,0xfd);
 padded.set(bytes,7);
 const view=new DataView(padded.buffer,padded.byteOffset+7,bytes.length);
 const parsed=inspectWasmBytes(view,{maxModuleBytes:bytes.length,maxMemoryPages:1});
 assert.equal(parsed.memoryCount,1);
 assert.equal(parsed.memoryInitial,1);
 assert.equal(parsed.memoryMaximum,1);
 assert.deepEqual([...parsed.bytes],[...bytes]);
 padded.fill(0);
 assert.deepEqual([...parsed.bytes],[...bytes],'view must not alias inspected bytes');
});

test('Node Buffer subarray preserves offset and byte budget for the same module',()=>{
 const padded=Buffer.alloc(bytes.length+10,0xee);
 padded.set(bytes,5);
 const slice=padded.subarray(5,5+bytes.length);
 assert.deepEqual([...inspectWasmBytes(slice,{maxModuleBytes:bytes.length,maxMemoryPages:1}).bytes],[...bytes]);
 assert.throws(()=>inspectWasmBytes(slice,{maxModuleBytes:bytes.length-1,maxMemoryPages:1}),/Wasm module exceeds maximum byte size/);
});
