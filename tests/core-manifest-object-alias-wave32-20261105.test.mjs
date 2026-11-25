import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotCoreManifest} from '../src/core-manifest-snapshot.mjs';

// Source-backed host manifest admission only; neither crypto nor Wasm guest ran.
test('shared object aliasing and cycles are not admitted', () => {
  const shared = {maximumPages: 2};
  assert.throws(
    () => snapshotCoreManifest({memory: shared, duplicate: shared}),
    /invalid browser core Wasm manifest serialization/,
  );
  const cyclic = Object.create(null);
  cyclic.self = cyclic;
  assert.throws(() => snapshotCoreManifest(cyclic), /invalid browser core Wasm manifest serialization/);
});

test('dense arrays pass but holes and hidden array authority fail closed', () => {
  const dense = snapshotCoreManifest({imports: ['env', 'wasi']});
  assert.deepEqual([...dense.imports], ['env', 'wasi']);
  assert.ok(Object.isFrozen(dense.imports));
  assert.equal(Object.getPrototypeOf(dense), null);

  const hole = [];
  hole.length = 2;
  hole[1] = 'env';
  assert.throws(() => snapshotCoreManifest({imports: hole}), /invalid browser core Wasm manifest serialization/);

  const decorated = ['env'];
  Object.defineProperty(decorated, 'secret', {value: true, enumerable: false});
  assert.throws(() => snapshotCoreManifest({imports: decorated}), /invalid browser core Wasm manifest serialization/);
});

test('accessors are rejected without evaluating a getter', () => {
  let calls = 0;
  const input = Object.create(null);
  Object.defineProperty(input, 'memory', {
    enumerable: true,
    get() { ++calls; return {maximumPages: 2}; },
  });
  assert.throws(() => snapshotCoreManifest(input), /invalid browser core Wasm manifest serialization/);
  assert.equal(calls, 0);
});

test('negative-zero and unsafe integer budgets are not canonicalized', () => {
  for (const n of [-0, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN]) {
    assert.throws(() => snapshotCoreManifest({pages: n}), /invalid browser core Wasm manifest serialization/);
  }
});
