import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotCoreManifest} from '../src/core-manifest-snapshot.mjs';

const rejected = candidate => assert.throws(() => snapshotCoreManifest(candidate),
  /invalid browser core Wasm manifest serialization/);

test('4096-byte combined key/value budget counts encoded UTF-8, not code units', () => {
  const accepted = snapshotCoreManifest({id:'é'.repeat(2047)});
  assert.equal(accepted.id.length,2047);
  assert.ok(Object.isFrozen(accepted));
  rejected({id:'é'.repeat(2048)});
  const emoji = snapshotCoreManifest({x:'🚀'.repeat(1023)});
  assert.equal(emoji.x,'🚀'.repeat(1023));
  rejected({x:'🚀'.repeat(1024)});
});

test('lone surrogates are refused in data and property names', () => {
  rejected({value:'\ud800'});
  rejected({value:'\udc00'});
  rejected({'\ud800':'ok'});
  rejected({'\udc00':'ok'});
  const result = snapshotCoreManifest({'\ud83d\ude80':'valid pair'});
  assert.equal(result['🚀'],'valid pair');
});

test('a shared nested object cannot impersonate two independent manifest values', () => {
  const aliased = Object.freeze({key:'value'});
  rejected({left:aliased,right:aliased});
  const result=snapshotCoreManifest({left:{key:'value'},right:{key:'value'}});
  assert.equal(result.left.key,'value');
  assert.equal(result.right.key,'value');
  assert.notStrictEqual(result.left,result.right);
});
