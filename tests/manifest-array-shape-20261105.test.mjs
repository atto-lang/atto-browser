import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotCoreManifest} from '../src/core-manifest-snapshot.mjs';

test('fully materialized 32-slot arrays admit frozen, separate copies',()=>{
  const original=Array(32).fill(0);
  const copy=snapshotCoreManifest(original);
  assert.equal(copy.length,32);
  assert.notStrictEqual(copy,original);
  assert.ok(Object.isFrozen(copy));
  original[0]=42;
  assert.equal(copy[0],0);
  assert.throws(()=>snapshotCoreManifest(Array(33).fill(0)),
    /invalid browser core Wasm manifest serialization/);
});

test('sparse slots and extra own array keys cannot be lost in JSON serialization',()=>{
  assert.throws(()=>snapshotCoreManifest([,1]),/invalid browser core Wasm manifest serialization/);
  const array=[1];array.extra=2;
  assert.throws(()=>snapshotCoreManifest(array),/invalid browser core Wasm manifest serialization/);
});

test('array getter is never invoked during snapshot admission',()=>{
  const array=[0];let getterCalls=0;
  Object.defineProperty(array,'0',{get(){getterCalls++;throw Error('untrusted getter executed')}});
  assert.throws(()=>snapshotCoreManifest(array),/invalid browser core Wasm manifest serialization/);
  assert.equal(getterCalls,0);
});

test('alias reuse and noncanonical array prototypes are denied',()=>{
  const entry={safe:1};
  assert.throws(()=>snapshotCoreManifest([entry,entry]),/invalid browser core Wasm manifest serialization/);
  const array=[1];
  Object.setPrototypeOf(array,null);
  assert.throws(()=>snapshotCoreManifest(array),/invalid browser core Wasm manifest serialization/);
});
