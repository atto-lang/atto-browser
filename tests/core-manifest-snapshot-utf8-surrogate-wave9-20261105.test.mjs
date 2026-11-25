import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotCoreManifest} from '../src/core-manifest-snapshot.mjs';

const invalid=value=>assert.throws(()=>snapshotCoreManifest(value),
  /invalid browser core Wasm manifest serialization/);

test('paired astral Unicode survives in a frozen detached manifest',()=>{
  const raw={emoji:'🚀'};
  const copy=snapshotCoreManifest(raw);
  assert.equal(copy.emoji,'🚀');
  assert.equal(Object.getPrototypeOf(copy),null);
  assert.equal(Object.isFrozen(copy),true);
  raw.emoji='changed';
  assert.equal(copy.emoji,'🚀');
});

test('unpaired high and low UTF-16 surrogates never enter manifest data',()=>{
  invalid({x:'\ud800'});
  invalid({x:'\udc00'});
});

test('format-control Unicode is forbidden in manifest member names',()=>{
  invalid({['ab\u200dcd']:1});
});

test('astral UTF-8 byte ceiling is exact, not a UTF-16 character allowance',()=>{
  assert.equal(snapshotCoreManifest('🚀'.repeat(1024)).length,2048);
  invalid('🚀'.repeat(1025));
});

test('hidden symbol keys and nonenumerable fields cannot evade admission',()=>{
  const arr=[1];
  arr[Symbol('hidden')]=3;
  invalid(arr);
  const object={};
  Object.defineProperty(object,'hidden',{value:1,enumerable:false});
  invalid(object);
});

test('accessor-backed members must be rejected without running the getter',()=>{
  let invoked=0;
  const value={};
  Object.defineProperty(value,'bad',{enumerable:true,get(){invoked++;throw Error('unsafe getter');}});
  invalid(value);
  assert.equal(invoked,0);
});
