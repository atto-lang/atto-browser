import test from 'node:test';
import assert from 'node:assert/strict';
import {assertCoreI64Entry} from '../src/abi.mjs';

const section=(id,body)=>[id,body.length,...body];
const name=s=>{const bytes=[...new TextEncoder().encode(s)];return [bytes.length,...bytes];};
const wasm=(entry='main',params=[],results=[0x7e])=>Uint8Array.from([
 0,97,115,109,1,0,0,0,
 ...section(1,[1,0x60,params.length,...params,results.length,...results]),
 ...section(3,[1,0]),
 ...section(7,[1,...name(entry),0,0]),
 ...section(10,[1,4,0,results[0]===0x7e?0x42:0x41,42,0x0b])
]);

test('core browser ABI admits one genuine valid zero-arg i64 function',()=>{
 const bytes=wasm();
 assert.equal(WebAssembly.validate(bytes),true);
 assert.doesNotThrow(()=>assertCoreI64Entry(bytes,'main'));
 assert.throws(()=>assertCoreI64Entry(bytes,'missing'),/exact \(\) -> i64/);
});

test('leading UTF-8 BOM is an export-name codepoint rather than disposable source markup',()=>{
 const marked='\uFEFFmain',bytes=wasm(marked);
 assert.equal(WebAssembly.validate(bytes),true);
 assert.doesNotThrow(()=>assertCoreI64Entry(bytes,marked));
 assert.throws(()=>assertCoreI64Entry(bytes,'main'),/exact \(\) -> i64/);
});

test('ABI rejection distinguishes function type from accidental same-name non-i64 exports',()=>{
 assert.throws(()=>assertCoreI64Entry(wasm('main',[],[0x7f]),'main'),/exact \(\) -> i64/);
 assert.throws(()=>assertCoreI64Entry(wasm('main',[0x7e]),'main'),/exact \(\) -> i64/);
 const bytes=Uint8Array.from([
  0,97,115,109,1,0,0,0,
  ...section(1,[1,0x60,0,1,0x7e]),
  ...section(3,[1,0]),
  ...section(7,[1,2,0xc3,0x28,0,0])
 ]);
 assert.throws(()=>assertCoreI64Entry(bytes,'main'));
});
