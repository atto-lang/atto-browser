import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotCoreManifest} from '../src/core-manifest-snapshot.mjs';

const invalid = input => assert.throws(() => snapshotCoreManifest(input), /invalid browser core Wasm manifest serialization/);

test('distinct input paths cannot reuse the same mutable object identity', () => {
  const shared = {value:1};
  invalid({a:shared,b:shared});
  const detached = snapshotCoreManifest({a:{value:1},b:{value:1}});
  assert.notStrictEqual(detached.a, detached.b);
  assert.equal(Object.getPrototypeOf(detached.a), null);
  assert.ok(Object.isFrozen(detached.b));
});

test('hidden nested authority and symbol keys are refused before snapshotting', () => {
  const inner = {ok:true};
  Object.defineProperty(inner, 'hidden', {value:1, enumerable:false});
  invalid({inner});
  const symbols = {};
  symbols[Symbol('hidden')] = 7;
  invalid(symbols);
});

test('numeric authority and invalid Unicode key spellings cannot normalize silently', () => {
  invalid({n:-0});
  invalid({n:Number.MAX_SAFE_INTEGER + 1});
  invalid({'\ud800':0});
  assert.equal(snapshotCoreManifest({n:0.5}).n, 0.5);
});

test('aggregate UTF-8 budget includes both keys and values at the exact boundary', () => {
  const exact = {a:'x'.repeat(2048), b:'x'.repeat(2046)};
  assert.equal(snapshotCoreManifest(exact).b.length, 2046);
  invalid({a:'x'.repeat(2048), b:'x'.repeat(2047)});
});
