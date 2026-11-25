import test from 'node:test';
import assert from 'node:assert/strict';
import {assertCoreI64Entry as check} from '../src/abi.mjs';

const head=[0,97,115,109,1,0,0,0];
const section=(id,body)=>[id,body.length,...body];
const moduleBytes=(index=[1],name='main',kind=0)=>Uint8Array.from([
 ...head,
 ...section(1,[2,0x60,0,1,0x7f,0x60,0,1,0x7e]),
 ...section(3,[2,0,1]),
 ...section(7,[1,...(()=>{const x=[...new TextEncoder().encode(name)];return[x.length,...x];})(),kind,...index]),
 ...section(10,[2,4,0,0x41,42,0x0b,4,0,0x42,42,0x0b])
]);

test('core entry resolves second function i64 signature, not earlier i32 function',()=>{
 const valid=moduleBytes();
 assert.equal(WebAssembly.validate(valid),true);
 assert.doesNotThrow(()=>check(valid,'main'));
 const wrong=moduleBytes([0]);
 assert.equal(WebAssembly.validate(wrong),true);
 assert.throws(()=>check(wrong,'main'),/exact \(\) -> i64 signature/);
});

test('export identity includes UTF-8 leading BOM and exact case',()=>{
 const withBom=moduleBytes([1],String.fromCharCode(0xfeff)+'main');
 assert.doesNotThrow(()=>check(withBom,String.fromCharCode(0xfeff)+'main'));
 assert.throws(()=>check(withBom,'main'),/exact \(\) -> i64 signature/);
 assert.throws(()=>check(moduleBytes(),'Main'),/exact \(\) -> i64 signature/);
});

test('nonfunction export and out-of-range index never acquire i64 authority',()=>{
 assert.throws(()=>check(moduleBytes([1],'main',2),'main'),/core Wasm entry is not a function/);
 assert.throws(()=>check(moduleBytes([2]),'main'),/exact \(\) -> i64 signature/);
});

test('padded integer index is rejected even if the Wasm engine parses it',()=>{
 const padded=moduleBytes([0x81,0]);
 assert.equal(WebAssembly.validate(padded),true);
 assert.throws(()=>check(padded,'main'),/noncanonical Wasm ABI integer/);
});
