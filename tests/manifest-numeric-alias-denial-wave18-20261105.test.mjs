import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotCoreManifest as snapshot} from '../src/core-manifest-snapshot.mjs';

test('snapshot deep-copies and freezes inert manifest records without mutating source',()=>{
 const shared={maximumPages:2},original={memory:shared,imports:[],producer:{source:'x'}};
 const copy=snapshot(original);
 assert.equal(copy.memory.maximumPages,2);
 assert.equal(Object.getPrototypeOf(copy),null);
 assert.ok(Object.isFrozen(copy));
 assert.ok(Object.isFrozen(copy.memory));
 shared.maximumPages=9;
 assert.equal(copy.memory.maximumPages,2);
 assert.equal(original.memory.maximumPages,9);
});

test('noncanonical negative zero and unsafe integers cannot become manifest authority',()=>{
 for(const bad of [-0,Number.MAX_SAFE_INTEGER+1,Infinity,NaN])
  assert.throws(()=>snapshot({memory:{maximumPages:bad}}),/invalid browser core Wasm manifest serialization/);
 assert.equal(snapshot({memory:{maximumPages:1}}).memory.maximumPages,1);
});

test('cycles, shared nested aliases and exotic prototypes fail closed',()=>{
 const shared={x:'abc'};
 assert.throws(()=>snapshot({left:shared,right:shared}),/invalid browser core Wasm manifest serialization/);
 const cycle={};cycle.self=cycle;
 assert.throws(()=>snapshot(cycle),/invalid browser core Wasm manifest serialization/);
 assert.throws(()=>snapshot({item:new Date()}),/invalid browser core Wasm manifest serialization/);
});

test('a getter cannot execute during snapshot, including nested array slots',()=>{
 let calls=0;const arr=[1];
 Object.defineProperty(arr,'0',{enumerable:true,get(){calls++;throw Error('unexpected getter');}});
 assert.throws(()=>snapshot({imports:arr}),/invalid browser core Wasm manifest serialization/);
 assert.equal(calls,0);
});
