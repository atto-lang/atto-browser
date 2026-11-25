// Host-only manifest snapshot regression; no browser guest claims.
import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotCoreManifest} from '../src/core-manifest-snapshot.mjs';

test('nested arrays and records remain frozen after caller mutates its originals', () => {
  const source = {release:{name:'demo', options:[{enabled:true}, {version:2}]}};
  const snapshot = snapshotCoreManifest(source);
  source.release.options[0].enabled = false;
  source.release.options.push({version:3});
  source.release.name = 'replaced';
  assert.equal(snapshot.release.name, 'demo');
  assert.deepEqual(snapshot.release.options.map(x => x.enabled ?? x.version), [true,2]);
  assert.equal(Object.getPrototypeOf(snapshot.release.options[0]), null);
  for (const value of [snapshot,snapshot.release,snapshot.release.options,
    snapshot.release.options[0]]) assert.ok(Object.isFrozen(value));
});

test('nested accessors are denied without invoking caller code', () => {
  let called = 0;
  const entry = {};
  Object.defineProperty(entry,'value',{enumerable:true,get(){called++;throw Error('called')}});
  assert.throws(() => snapshotCoreManifest({entries:[entry]}),
    /invalid browser core Wasm manifest serialization/);
  assert.equal(called,0);
});
