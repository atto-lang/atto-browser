import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotCoreManifest} from '../src/core-manifest-snapshot.mjs';

const denied = original => assert.throws(() => snapshotCoreManifest(original), /invalid browser core Wasm manifest serialization/);

test('deep manifest copies are frozen, null-prototype owned records and not caller aliases', () => {
  const original = {meta:{version:1,name:'wasm'},items:[{id:1},'ready']};
  const snap = snapshotCoreManifest(original);
  assert.equal(Object.getPrototypeOf(snap),null);
  assert.equal(Object.getPrototypeOf(snap.meta),null);
  assert.equal(Object.getPrototypeOf(snap.items[0]),null);
  for (const v of [snap,snap.meta,snap.items,snap.items[0]]) assert.ok(Object.isFrozen(v));
  assert.notEqual(snap.meta,original.meta);
  assert.notEqual(snap.items,original.items);
  original.meta.name='mutated'; original.items[0].id=9;
  assert.equal(snap.meta.name,'wasm'); assert.equal(snap.items[0].id,1);
});

test('untrusted getter-backed manifest keys and toJSON are never executed', () => {
  let invoked=0;
  const obj={ok:1};
  Object.defineProperty(obj,'hidden',{enumerable:false,get(){invoked++;return 2;}});
  denied(obj);
  const hooks={ok:1};
  Object.defineProperty(hooks,'toJSON',{get(){invoked++;return () => 5;}});
  denied(hooks);
  assert.equal(invoked,0);
});

test('one source object cannot be smuggled through repeated references or magic keys', () => {
  const shared={id:7};
  denied({first:shared,second:shared});
  const cycling={}; cycling.self=cycling;
  denied(cycling);
  for(const key of ['__proto__','prototype','constructor','bad\u2028key']) {
    const data=Object.create(null); data[key]=1; denied(data);
  }
  assert.equal(snapshotCoreManifest({plain:true}).plain,true);
});
