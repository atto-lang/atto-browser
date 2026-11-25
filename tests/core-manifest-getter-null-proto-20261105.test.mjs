import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotCoreManifest} from '../src/core-manifest-snapshot.mjs';

const rejects=input=>assert.throws(()=>snapshotCoreManifest(input),/invalid browser core Wasm manifest serialization/);
test('accepted object graphs are frozen detached null-prototype snapshots',()=>{
  const original={meta:{label:'alpha'},rows:[{id:1}]};
  const snapshot=snapshotCoreManifest(original);
  assert.equal(Object.getPrototypeOf(snapshot),null);
  assert.equal(Object.getPrototypeOf(snapshot.meta),null);
  assert.ok(Object.isFrozen(snapshot));assert.ok(Object.isFrozen(snapshot.meta));
  assert.ok(Object.isFrozen(snapshot.rows));
  original.meta.label='changed';original.rows[0].id=99;
  assert.equal(snapshot.meta.label,'alpha');
  assert.equal(snapshot.rows[0].id,1);
});
test('malicious getters and toJSON hooks do not execute during admission',()=>{
  let calls=0;
  const object={plain:1};
  Object.defineProperty(object,'gettable',{enumerable:true,get(){calls++;throw Error('unexpected');}});
  rejects(object);assert.equal(calls,0);
  const toJSON={a:1};
  Object.defineProperty(toJSON,'toJSON',{enumerable:true,get(){calls++;throw Error('unexpected');}});
  rejects(toJSON);assert.equal(calls,0);
});
test('array holes, symbol properties and prototype-magic keys remain inadmissible',()=>{
  const sparse=Array(2);sparse[0]=1;rejects(sparse);
  const sym={safe:true};sym[Symbol('authority')]='forged';rejects(sym);
  rejects(JSON.parse('{"__proto__":{"polluted":true}}'));
  assert.equal(Object.prototype.polluted,undefined);
});
test('nested array snapshots are separate from caller-owned storage',()=>{
  const original=[{a:[1,2]},false];
  const snapshot=snapshotCoreManifest(original);
  assert.notStrictEqual(snapshot,original);assert.ok(Object.isFrozen(snapshot));
  original[0].a[0]=999;
  assert.deepEqual(snapshot[0].a,[1,2]);
});
