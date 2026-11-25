import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {inspectWasmBytes} from '../src/inspect.mjs';

const header=[0,97,115,109,1,0,0,0];

test('foreign realm ArrayBuffer is admitted via genuine internal byte-length slot',()=>{
 const buffer=runInNewContext('new ArrayBuffer(8)');
 new Uint8Array(buffer).set(header);
 const parsed=inspectWasmBytes(buffer,{maxModuleBytes:8});
 assert.deepEqual([...parsed.bytes],header);
 new Uint8Array(buffer)[1]=0;
 assert.equal(parsed.bytes[1],97);
});

test('foreign realm typed array retains native byte offset and ignores caller iterator',()=>{
 const view=runInNewContext('new Uint8Array(new ArrayBuffer(16),4,8)');
 new Uint8Array(view.buffer,4,8).set(header);
 let invoked=0;
 Object.defineProperty(view,Symbol.iterator,{get(){invoked++;throw Error('untrusted iterator');}});
 const parsed=inspectWasmBytes(view,{maxModuleBytes:8});
 assert.deepEqual([...parsed.bytes],header);
 assert.equal(invoked,0);
});

test('foreign realm DataView fails closed rather than reading shadowed JS accessors',()=>{
 const view=runInNewContext('new DataView(new ArrayBuffer(8))');
 new Uint8Array(view.buffer).set(header);
 let invoked=0;
 for(const name of ['buffer','byteOffset','byteLength'])
  Object.defineProperty(view,name,{get(){invoked++;throw Error('untrusted '+name);}});
 assert.throws(()=>inspectWasmBytes(view,{maxModuleBytes:8}),TypeError);
 assert.equal(invoked,0);
});
