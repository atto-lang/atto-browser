import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotCoreManifest} from '../src/core-manifest-snapshot.mjs';

// Tests structural admission only; no browser Guest/Wasm execution.
test('manifest arrays admit 32 entries but reject 33 and sparse/extra own keys',()=>{
 assert.equal(snapshotCoreManifest(Array(32).fill(null)).length,32);
 assert.throws(()=>snapshotCoreManifest(Array(33).fill(null)),/serialization/);
 const sparse=Array(2);sparse[1]='one';
 assert.throws(()=>snapshotCoreManifest(sparse),/serialization/);
 const extra=[1];extra.extra='hidden';
 assert.throws(()=>snapshotCoreManifest(extra),/serialization/);
});

test('total node budget fails at 129 but admits a 125-node tree',()=>{
 const tree=n=>Array.from({length:n},()=>[null,null,null]);
 assert.equal(snapshotCoreManifest(tree(31)).length,31); // 1+31+93=125
 assert.throws(()=>snapshotCoreManifest(tree(32)),/serialization/); // 129
});

test('manifest text quota is exact and deep immutable copies stay detached',()=>{
 assert.equal(snapshotCoreManifest('x'.repeat(4096)).length,4096);
 assert.throws(()=>snapshotCoreManifest('x'.repeat(4097)),/serialization/);
 const input={producer:{record:[{compiler:'wasm'}]}};
 const frozen=snapshotCoreManifest(input);
 input.producer.record[0].compiler='mutated';
 assert.equal(frozen.producer.record[0].compiler,'wasm');
 assert.equal(Object.isFrozen(frozen.producer.record[0]),true);
});

test('array accessors and shared object references cannot bypass data-only admission',()=>{
 const items=[1];let getterCalls=0;
 Object.defineProperty(items,'0',{enumerable:true,configurable:true,get(){
   getterCalls++;throw Error('must not run');
 }});
 assert.throws(()=>snapshotCoreManifest(items),/serialization/);
 assert.equal(getterCalls,0);
 const shared={value:42};
 assert.throws(()=>snapshotCoreManifest([shared,shared]),/serialization/);
});
