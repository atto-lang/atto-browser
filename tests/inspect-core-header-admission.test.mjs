import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectWasmBytes} from '../src/inspect.mjs';

const canonical=[0,97,115,109,1,0,0,0];
const inspect=xs=>inspectWasmBytes(Uint8Array.from(xs),{maxModuleBytes:64});

test('browser accepts an empty core and inert custom-section bytes',()=>{
 const basic=inspect(canonical);
 assert.deepEqual([...basic.bytes],canonical);
 assert.equal(basic.memoryCount,0);
 const custom=[...canonical,0,1,0];
 assert.equal(WebAssembly.validate(Uint8Array.from(custom)),true);
 assert.deepEqual([...inspect(custom).bytes],custom);
});

test('invalid magic and all version mutations are denied before publication',()=>{
 for(let i=0;i<8;i++){
  const altered=canonical.slice();altered[i]^=1;
  assert.throws(()=>inspect(altered),/invalid core module header/,`byte ${i}`);
 }
 for(let size=0;size<8;size++)
  assert.throws(()=>inspect(canonical.slice(0,size)),/invalid core module header/);
});

test('duplicate known core sections cannot be promoted as valid bytes',()=>{
 const memory=[5,4,1,1,1,2];
 const duplicate=Uint8Array.from([...canonical,...memory,...memory]);
 assert.equal(WebAssembly.validate(duplicate),false);
 assert.throws(()=>inspectWasmBytes(duplicate,{maxModuleBytes:64}),/invalid WebAssembly module/);
});
