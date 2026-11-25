import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotCoreManifest} from '../src/core-manifest-snapshot.mjs';

const invalid = input => assert.throws(() => snapshotCoreManifest(input), /invalid browser core Wasm manifest serialization/);

test('snapshots are deeply detached, frozen and keep null-prototype objects', () => {
  const input={limits:[{name:'first', quota:3}]};
  const snapshot=snapshotCoreManifest(input);
  assert.notStrictEqual(snapshot,input);
  assert.equal(Object.getPrototypeOf(snapshot),null);
  assert.equal(Object.getPrototypeOf(snapshot.limits[0]),null);
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.limits));
  assert.ok(Object.isFrozen(snapshot.limits[0]));
  input.limits[0].quota=20;
  assert.equal(snapshot.limits[0].quota,3);
});

test('rejected accessor must not run, including inside nested objects', () => {
  let calls=0;
  const bad={};
  Object.defineProperty(bad,'danger',{enumerable:true,get() {calls++;throw Error('accessor executed');}});
  invalid({nested:bad});
  assert.equal(calls,0);
});

test('holes, symbols, nonplain objects, and cyclic references fail closed', () => {
  invalid(new Array(2));
  const withSymbol=[7];withSymbol[Symbol('inert')]='hidden'; invalid(withSymbol);
  invalid(Object.create({inherited:1}));
  const cyclic={};cyclic.loop=cyclic;invalid(cyclic);
});

test('UTF-8 text budget is inclusive for astral code points', () => {
  assert.equal(snapshotCoreManifest('🚀'.repeat(1024)).length,2048);
  invalid('🚀'.repeat(1025));
});
