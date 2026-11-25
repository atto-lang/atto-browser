import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectWasmBytes} from '../src/inspect.mjs';

const magic=[0,97,115,109,1,0,0,0];
function viewCases(){
 const make=()=>Uint8Array.from([7,6,5,4,...magic,3,2,1,0]);
 const a=make(),b=make(),c=make(),d=make();
 return [
  ['bytes',new Uint8Array(a.buffer,4,8),a],
  ['halfwords',new Uint16Array(b.buffer,4,4),b],
  ['words',new Int32Array(c.buffer,4,2),c],
  ['DataView',new DataView(d.buffer,4,8),d]
 ];
}

test('browser loader consumes native view offsets across four intrinsic view kinds',()=>{
 for(const [kind,view,backing] of viewCases()){
  const got=inspectWasmBytes(view,{maxModuleBytes:8});
  assert.deepEqual(Array.from(got.bytes),magic,kind);
  backing[5]=0;
  assert.equal(got.bytes[1],97,kind+' immutable snapshot');
 }
});

test('shadowed public view accessors cannot steer browser byte copying',()=>{
 for(const [kind,view] of viewCases()){
  let invoked=0;
  for(const name of ['buffer','byteOffset','byteLength'])
   Object.defineProperty(view,name,{get(){invoked++;throw Error('poisoned');}});
  Object.defineProperty(view,Symbol.iterator,{get(){invoked++;throw Error('poisoned');}});
  assert.deepEqual(Array.from(inspectWasmBytes(view,{maxModuleBytes:8}).bytes),magic,kind);
  assert.equal(invoked,0,kind);
 }
});

test('browser view matrix enforces exact native byte count, not array length',()=>{
 for(const [kind,view] of viewCases()){
  assert.throws(()=>inspectWasmBytes(view,{maxModuleBytes:7}),/invalid maximum module size/);
  assert.equal(inspectWasmBytes(view,{maxModuleBytes:8}).bytes.length,8,kind);
 }
});
