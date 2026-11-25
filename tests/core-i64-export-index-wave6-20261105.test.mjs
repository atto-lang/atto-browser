import test from 'node:test';
import assert from 'node:assert/strict';
import {assertCoreI64Entry} from '../src/abi.mjs';

const header=[0,97,115,109,1,0,0,0];
const section=(id,body)=>[id,body.length,...body];
const build=(indexBytes=[1],kind=0)=>Uint8Array.from([
  ...header,
  ...section(1,[2,0x60,0,1,0x7f,0x60,0,1,0x7e]),
  ...section(3,[2,0,1]),
  ...section(7,[1,4,109,97,105,110,kind,...indexBytes]),
  ...section(10,[2,4,0,0x41,42,0x0b,4,0,0x42,42,0x0b])
]);

test('actual exported function index selects i64 type even after an i32 function',()=>{
  const bytes=build([1]);
  assert.equal(WebAssembly.validate(bytes),true);
  assert.doesNotThrow(()=>assertCoreI64Entry(bytes,'main'));
  const i32=build([0]);
  assert.equal(WebAssembly.validate(i32),true);
  assert.throws(()=>assertCoreI64Entry(i32,'main'),/exact \(\) -> i64 signature/);
});

test('wrong function index, case-sensitive name or nonfunction export is rejected',()=>{
  assert.throws(()=>assertCoreI64Entry(build([2]),'main'),/exact \(\) -> i64 signature/);
  assert.throws(()=>assertCoreI64Entry(build([1]),'Main'),/exact \(\) -> i64 signature/);
  assert.throws(()=>assertCoreI64Entry(build([1],2),'main'),/not a function/);
});

test('padded varuint alias may be Wasm valid but is not a canonical Atto ABI index',()=>{
  const padded=build([0x81,0]);
  assert.equal(WebAssembly.validate(padded),true);
  assert.throws(()=>assertCoreI64Entry(padded,'main'),/noncanonical Wasm ABI integer/);
});
