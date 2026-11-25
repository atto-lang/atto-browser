// Host snapshot-only checks: no compiled browser guest is claimed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotCoreManifest} from '../src/core-manifest-snapshot.mjs';

test('dense plain arrays retain own values and become frozen independent snapshots', () => {
  const original=[{name:'one'},null,false,3];
  const result=snapshotCoreManifest(original);
  original[0].name='two';
  original.push(5);
  assert.equal(result.length,4);
  assert.equal(result[0].name,'one');
  assert.equal(Object.getPrototypeOf(result[0]),null);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result[0]));
});

test('sparse and augmented arrays fail before JSON silently drops holes or fields', () => {
  const sparse=new Array(2);sparse[1]='present';
  const augmented=['safe'];augmented.role='invisible-after-json';
  const hidden=['safe'];Object.defineProperty(hidden,'token',{value:'secret'});
  for(const bad of [sparse,augmented,hidden]) {
    assert.throws(()=>snapshotCoreManifest({items:bad}),
      /invalid browser core Wasm manifest serialization/);
  }
});

test('nested object accessors remain inert even when embedded in an array', () => {
  let called=0;
  const hostile={};
  Object.defineProperty(hostile,'token',{enumerable:true,get(){called++;throw Error('invoked')}});
  assert.throws(()=>snapshotCoreManifest([hostile]),
    /invalid browser core Wasm manifest serialization/);
  assert.equal(called,0);
});
