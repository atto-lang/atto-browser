import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotCoreManifest} from '../src/core-manifest-snapshot.mjs';

test('admitted manifest is detached, deeply frozen and null-prototype keyed',()=>{
 const original={entry:'main',metadata:{backend:'wasm'},caps:[]};
 const saved=snapshotCoreManifest(original);
 original.entry='changed';
 original.metadata.backend='llvm';
 original.caps.push('filesystem');
 assert.equal(saved.entry,'main');
 assert.equal(saved.metadata.backend,'wasm');
 assert.deepEqual(saved.caps,[]);
 assert.equal(Object.getPrototypeOf(saved),null);
 assert.equal(Object.isFrozen(saved),true);
 assert.equal(Object.isFrozen(saved.metadata),true);
 assert.equal(Object.isFrozen(saved.caps),true);
});

test('prototype-magic keys, forbidden format controls and symbol keys are rejected',()=>{
 for(const key of ['__proto__','prototype','constructor','bad\u200dkey','bad\u0000key']){
  const value=Object.create(null);
  Object.defineProperty(value,key,{value:1,enumerable:true});
  assert.throws(()=>snapshotCoreManifest(value),/invalid browser core Wasm manifest serialization/);
 }
 const symbol={};symbol[Symbol('authority')]=1;
 assert.throws(()=>snapshotCoreManifest(symbol),/invalid browser core Wasm manifest serialization/);
});

test('accessor, hole, repeated alias and cyclic data are denied before invoking getters',()=>{
 let calls=0;
 const value={};
 Object.defineProperty(value,'privilege',{enumerable:true,get(){calls++;return 1;}});
 assert.throws(()=>snapshotCoreManifest(value),/invalid browser core Wasm manifest serialization/);
 assert.equal(calls,0);
 assert.throws(()=>snapshotCoreManifest({caps:new Array(1)}),/invalid browser core Wasm manifest serialization/);
 const child={version:1};
 assert.throws(()=>snapshotCoreManifest({a:child,b:child}),/invalid browser core Wasm manifest serialization/);
 const cycle={};cycle.self=cycle;
 assert.throws(()=>snapshotCoreManifest(cycle),/invalid browser core Wasm manifest serialization/);
});