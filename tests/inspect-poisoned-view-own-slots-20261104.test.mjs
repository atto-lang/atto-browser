import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectWasmBytes} from '../src/inspect.mjs';

const header=[0,97,115,109,1,0,0,0];
test('native view slots ignore poisoned own getters and iterator',()=>{
 const view=Uint8Array.from(header);
 for(const key of ['buffer','byteOffset','byteLength'])
  Object.defineProperty(view,key,{get(){throw Error('hostile '+key+' getter')}});
 Object.defineProperty(view,Symbol.iterator,{value(){throw Error('hostile iterator')}});
 const result=inspectWasmBytes(view,{maxModuleBytes:8,maxMemoryPages:1});
 assert.deepEqual(Array.from(result.bytes),header);
 assert.notStrictEqual(result.bytes,view);
 view.fill(255);
 assert.deepEqual(Array.from(result.bytes),header);
});
test('prototype-only faux view is not a real byte view',()=>{
 const forged=Object.create(Uint8Array.prototype);
 Object.defineProperty(forged,Symbol.toStringTag,{value:'Uint8Array'});
 assert.throws(()=>inspectWasmBytes(forged),/expected a Wasm ArrayBuffer or typed array/);
});
