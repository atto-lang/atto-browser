import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotCoreManifest} from '../src/core-manifest-snapshot.mjs';

test('nested manifest values are privately snapshotted and deeply frozen',()=>{
 const source={version:1,meta:{label:'v1'},flags:[true,false]};
 const copy=snapshotCoreManifest(source);
 source.meta.label='v2';
 source.flags[0]=false;
 assert.equal(copy.meta.label,'v1');
 assert.deepEqual(copy.flags,[true,false]);
 assert.equal(Object.getPrototypeOf(copy),null);
 assert.equal(Object.isFrozen(copy.meta),true);
 assert.equal(Object.isFrozen(copy.flags),true);
});

test('cycle and accessor records are denied without invoking untrusted getters',()=>{
 let called=0;
 const poisoned={};
 Object.defineProperty(poisoned,'data',{
  enumerable:true,
  get(){called++;throw Error('untrusted getter invoked');}
 });
 assert.throws(()=>snapshotCoreManifest(poisoned),/invalid browser core Wasm manifest serialization/);
 assert.equal(called,0);
 const cyclic={};
 cyclic.self=cyclic;
 assert.throws(()=>snapshotCoreManifest(cyclic),/invalid browser core Wasm manifest serialization/);
});

test('manifest array and text bounds and noncanonical numeric identities fail closed',()=>{
 assert.equal(snapshotCoreManifest('a'.repeat(4096)).length,4096);
 for(const value of [
  'a'.repeat(4097),new Array(33).fill(0),
  -0,Number.MAX_SAFE_INTEGER+2,Number.NaN
 ])assert.throws(()=>snapshotCoreManifest(value),/invalid browser core Wasm manifest serialization/);
});
