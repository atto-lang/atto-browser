import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotCoreManifest} from '../src/core-manifest-snapshot.mjs';

test('nested snapshots are frozen and detached from caller mutation',()=>{
  const input={actor:{limits:[1,2],name:'x'}};
  const out=snapshotCoreManifest(input);
  input.actor.limits[0]=99;input.actor.name='y';
  assert.equal(out.actor.limits[0],1);assert.equal(out.actor.name,'x');
  assert.ok(Object.isFrozen(out.actor));assert.ok(Object.isFrozen(out.actor.limits));
  assert.equal(Object.getPrototypeOf(out),null);
});
test('shared subobjects are rejected as ambiguous identity graphs',()=>{
  const reused={x:1};
  assert.throws(()=>snapshotCoreManifest({a:reused,b:reused}),/serialization/);
});
test('cycles are rejected without running caller toJSON hooks',()=>{
  let called=0;const obj={};
  obj.self=obj;obj.toJSON=()=>{called++;throw Error('poison');};
  assert.throws(()=>snapshotCoreManifest(obj),/serialization/);
  assert.equal(called,0);
});
test('nonenumerable nested index and poison accessor are rejected inertly',()=>{
  const bad=[1,2];
  Object.defineProperty(bad,'1',{value:2,enumerable:false});
  assert.throws(()=>snapshotCoreManifest({bad}),/serialization/);
  let calls=0;const o={};
  Object.defineProperty(o,'key',{enumerable:true,get(){calls++;throw Error('poison');}});
  assert.throws(()=>snapshotCoreManifest({o}),/serialization/);
  assert.equal(calls,0);
});