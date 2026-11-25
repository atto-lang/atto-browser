import test from 'node:test';
import assert from 'node:assert/strict';
import {assertCoreI64Entry} from '../src/abi.mjs';

const section=(id,body)=>[id,body.length,...body];
const header=[0,97,115,109,1,0,0,0];
const name=s=>[new TextEncoder().encode(s).length,...new TextEncoder().encode(s)];
const good=()=>Uint8Array.from([
 ...header,...section(1,[1,0x60,0,1,0x7e]),
 ...section(3,[1,0]),
 ...section(7,[1,...name('main'),0,0]),
 ...section(10,[1,4,0,0x42,42,0x0b])
]);

test('exact () -> i64 function exported as main is accepted by static ABI verifier',()=>{
 const bytes=good();
 assert.equal(WebAssembly.validate(bytes),true);
 assert.doesNotThrow(()=>assertCoreI64Entry(bytes,'main'));
});

test('a same-named non-function export cannot impersonate a guest entry',()=>{
 const bytes=good();
 const exportSectionOffset=8+7+4;
 const altered=Uint8Array.from(bytes);
 // Export section: count, UTF-8 name, kind, index. Replace kind with memory.
 let index=-1;
 for(let i=8;i<altered.length-6;i++)
  if(altered[i]===109&&altered[i+1]===97&&altered[i+2]===105&&altered[i+3]===110){
   index=i+4;break;
  }
 assert.notEqual(index,-1);
 altered[index]=2;
 assert.throws(()=>assertCoreI64Entry(altered,'main'),/not a function/);
});

test('static ABI reader refuses truncated section lengths and unknown entry names',()=>{
 const bytes=good();
 assert.throws(()=>assertCoreI64Entry(bytes,'Main'),/exact \(\) -> i64/);
 const truncated=Uint8Array.from([...header,7,50,1,4,109]);
 assert.throws(()=>assertCoreI64Entry(truncated,'main'),/truncated Wasm ABI section/);
});
