import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotCoreManifest} from '../src/core-manifest-snapshot.mjs';

const deny=input=>assert.throws(()=>snapshotCoreManifest(input),/invalid browser core Wasm manifest serialization/);

test('multibyte text consumes actual UTF-8 bytes, including key authority',()=>{
  const safe=snapshotCoreManifest({k:'é'.repeat(2047)});
  assert.equal(safe.k.length,2047);
  assert.ok(Object.isFrozen(safe));
  deny({k:'é'.repeat(2048)});
  const emoji=snapshotCoreManifest({k:'🚀'.repeat(1023)});
  assert.equal(emoji.k,'🚀'.repeat(1023));
  deny({k:'🚀'.repeat(1024)});
});

test('two fields share one cumulative byte ceiling instead of per-property limits',()=>{
  const accepted=snapshotCoreManifest({a:'é'.repeat(1024),b:'é'.repeat(1023)});
  assert.equal(accepted.b.length,1023);
  deny({a:'é'.repeat(1025),b:'é'.repeat(1023)});
});

test('multibyte manifest keys and ASCII values consume one exact budget',()=>{
  const key='é'.repeat(64);
  const safe=snapshotCoreManifest({[key]:'x'.repeat(3968)});
  assert.equal(safe[key].length,3968);
  deny({[key]:'x'.repeat(3969)});
});
