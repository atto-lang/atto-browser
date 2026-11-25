import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectWasmBytes} from '../src/inspect.mjs';

const header=[0,97,115,109,1,0,0,0];

test('DataView offset and length come from native slots rather than own getters',()=>{
  const backing=Uint8Array.from([255,...header,254]);
  const view=new DataView(backing.buffer,1,8);
  let invoked=0;
  for(const key of ['buffer','byteOffset','byteLength']){
    Object.defineProperty(view,key,{get(){invoked++;throw Error('poisoned '+key);}});
  }
  const result=inspectWasmBytes(view,{maxModuleBytes:8});
  assert.deepEqual(Array.from(result.bytes),header);
  assert.equal(result.memoryCount,0);
  assert.equal(invoked,0);
  backing[1]=255;
  assert.equal(result.bytes[0],0,'snapshot must be independent of original DataView');
});

test('shared DataView cannot disguise its backing buffer with an own property',()=>{
  if(typeof SharedArrayBuffer!=='function')return;
  const view=new DataView(new SharedArrayBuffer(8));
  Object.defineProperty(view,'buffer',{value:Uint8Array.from(header).buffer});
  assert.throws(()=>inspectWasmBytes(view,{maxModuleBytes:64}),
                /shared Wasm input memory is not admitted/);
});
