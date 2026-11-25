import test from 'node:test';
import assert from 'node:assert/strict';
import {assertCoreI64Entry as requireEntry} from '../src/abi.mjs';

const header=[0,97,115,109,1,0,0,0];
const section=(id,body)=>[id,body.length,...body];
const moduleBytes=(name='main',kind=0,resultType=0x7e,indexBytes=[0])=>{
  const n=Array.from(new TextEncoder().encode(name));
  const opcode=resultType===0x7e?0x42:0x41;
  return Uint8Array.from([...header,
    ...section(1,[1,0x60,0,1,resultType]),
    ...section(3,[1,0]),
    ...section(7,[1,n.length,...n,kind,...indexBytes]),
    ...section(10,[1,4,0,opcode,42,0x0b])]);
};

test('function export must match entry spelling, including U+FEFF prefix',()=>{
  const plain=moduleBytes('main');
  assert.doesNotThrow(()=>requireEntry(plain,'main'));
  assert.throws(()=>requireEntry(plain,'Main'),/exact \(\) -> i64 signature/);
  const withBom=moduleBytes(String.fromCharCode(0xfeff)+'main');
  assert.throws(()=>requireEntry(withBom,'main'),/exact \(\) -> i64 signature/);
  assert.doesNotThrow(()=>requireEntry(withBom,String.fromCharCode(0xfeff)+'main'));
});

test('export of an i32 function or nonfunction cannot impersonate i64',()=>{
  assert.throws(()=>requireEntry(moduleBytes('main',0,0x7f),'main'),/exact \(\) -> i64 signature/);
  assert.throws(()=>requireEntry(moduleBytes('main',2),'main'),/not a function/);
  assert.throws(()=>requireEntry(moduleBytes('main',0,0x7e,[2]),'main'),/exact \(\) -> i64 signature/);
});

test('noncanonical padded export index is refused despite valid core Wasm',()=>{
  const padded=moduleBytes('main',0,0x7e,[0x80,0]);
  assert.throws(()=>requireEntry(padded,'main'),/noncanonical Wasm ABI integer/);
  assert.doesNotThrow(()=>requireEntry(moduleBytes('main'),'main'));
});
