import test from 'node:test';
import assert from 'node:assert/strict';
import {assertCoreI64Entry} from '../src/abi.mjs';

const valid=()=>Uint8Array.from([
 0,97,115,109,1,0,0,0,
 1,5,1,0x60,0,1,0x7e,
 3,2,1,0,
 7,8,1,4,109,97,105,110,0,0
]);
test('canonical i64 entry is admitted and unknown export denied',()=>{
 assert.doesNotThrow(()=>assertCoreI64Entry(valid(),'main'));
 assert.throws(()=>assertCoreI64Entry(valid(),'missing'),/exact \(\) -> i64 signature/);
});
test('export type, function index and non-i64 result cannot impersonate entry',()=>{
 for(const [index,value] of [[14,0x7f],[27,2],[28,1]]){
  const bytes=valid();bytes[index]=value;
  assert.throws(()=>assertCoreI64Entry(bytes,'main'),/exact \(\) -> i64 signature|not a function/);
 }
});
test('padded length, truncated and malformed exports fail closed',()=>{
 const bytes=valid();
 const padded=Uint8Array.from([...bytes.slice(0,9),0x85,0,...bytes.slice(10)]);
 assert.throws(()=>assertCoreI64Entry(padded,'main'),/noncanonical Wasm ABI integer/);
 assert.throws(()=>assertCoreI64Entry(bytes.slice(0,-1),'main'),/truncated Wasm ABI section/);
 bytes[20]=2;
 assert.throws(()=>assertCoreI64Entry(bytes,'main'),/malformed Wasm ABI name|malformed Wasm ABI export|truncated Wasm ABI/);
});