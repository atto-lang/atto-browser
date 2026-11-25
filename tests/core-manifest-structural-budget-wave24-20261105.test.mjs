import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotCoreManifest as snapshot} from '../src/core-manifest-snapshot.mjs';

test('snapshots nested source data without retaining mutable aliases',()=>{
 const inner={maximumPages:2};
 const manifest={memory:inner,imports:[],producer:{compiler:'x'}};
 const copy=snapshot(manifest);
 assert.equal(Object.getPrototypeOf(copy),null);
 assert.equal(copy.memory.maximumPages,2);
 assert.ok(Object.isFrozen(copy));
 assert.ok(Object.isFrozen(copy.memory));
 assert.ok(Object.isFrozen(copy.imports));
 inner.maximumPages=99;
 assert.equal(copy.memory.maximumPages,2);
 assert.equal(manifest.memory.maximumPages,99);
});

test('aggregate UTF-8 text budget rejects individually bounded strings',()=>{
 const source={first:'a'.repeat(4000),second:'b'.repeat(100)};
 assert.throws(()=>snapshot(source),/invalid browser core Wasm manifest serialization/);
 assert.doesNotThrow(()=>snapshot({first:'a'.repeat(128),second:'b'.repeat(128)}));
});

test('duplicated references, aliases and cycles cannot smuggle reentrant data',()=>{
 const same={field:3};
 assert.throws(()=>snapshot({left:same,right:same}),/invalid browser core Wasm manifest serialization/);
 const cycle={};cycle.recursive=cycle;
 assert.throws(()=>snapshot(cycle),/invalid browser core Wasm manifest serialization/);
 assert.throws(()=>snapshot({array:new Array(1)}),/invalid browser core Wasm manifest serialization/);
});

test('excess object count, invalid Unicode keys and accessor slots fail before getters',()=>{
 const large={a:Array.from({length:32},()=>({v:1})),
  b:Array.from({length:32},()=>({v:1})),
  c:Array.from({length:32},()=>({v:1}))};
 assert.throws(()=>snapshot(large),/invalid browser core Wasm manifest serialization/);
 const spoof={};let reads=0;
 Object.defineProperty(spoof,'field',{enumerable:true,get(){reads++;throw Error('getter');}});
 assert.throws(()=>snapshot(spoof),/invalid browser core Wasm manifest serialization/);
 assert.equal(reads,0);
 assert.throws(()=>snapshot({['x'+String.fromCharCode(0x202e)]:1}),/invalid browser core Wasm manifest serialization/);
});
