import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotCoreManifest} from '../src/core-manifest-snapshot.mjs';

test('nested plain metadata is an owned frozen snapshot rather than live caller state', () => {
  const input={name:'guest', flags:[true,false], meta:{epoch:1}};
  const result=snapshotCoreManifest(input);
  input.name='modified';
  input.flags[0]=false;
  input.meta.epoch=2;
  assert.equal(result.name,'guest');
  assert.deepEqual(result.flags,[true,false]);
  assert.equal(result.meta.epoch,1);
  assert.equal(Object.getPrototypeOf(result),null);
  assert.equal(Object.isFrozen(result),true);
  assert.equal(Object.isFrozen(result.flags),true);
  assert.equal(Object.isFrozen(result.meta),true);
});

test('text admission uses actual UTF-8 byte identity, not JS UTF-16 units', () => {
  for(const exact of ['é'.repeat(2048),'🚀'.repeat(1024)])
    assert.equal(snapshotCoreManifest(exact),exact);
  for(const over of ['é'.repeat(2049),'🚀'.repeat(1025)])
    assert.throws(()=>snapshotCoreManifest(over),/invalid browser core Wasm manifest serialization/);
});

test('nonenumerable values and active descriptors cannot enter manifest snapshots', () => {
  let invoked=0;
  const options={stable:1};
  Object.defineProperty(options,'hidden',{enumerable:false,value:2});
  assert.throws(()=>snapshotCoreManifest(options),/invalid browser core Wasm manifest serialization/);
  const accessor={};
  Object.defineProperty(accessor,'authority',{enumerable:true,
    get(){invoked++;throw Error('untrusted getter ran')}});
  assert.throws(()=>snapshotCoreManifest(accessor),/invalid browser core Wasm manifest serialization/);
  assert.equal(invoked,0);
  const sparse=[1,,3];
  assert.throws(()=>snapshotCoreManifest(sparse),/invalid browser core Wasm manifest serialization/);
});

test('shared graph aliases, cycles and ill-formed Unicode fail before publication', () => {
  const shared={value:1};
  assert.throws(()=>snapshotCoreManifest({a:shared,b:shared}),/invalid browser core Wasm manifest serialization/);
  const cycle={}; cycle.self=cycle;
  assert.throws(()=>snapshotCoreManifest(cycle),/invalid browser core Wasm manifest serialization/);
  assert.throws(()=>snapshotCoreManifest('\ud800'),/invalid browser core Wasm manifest serialization/);
  assert.throws(()=>snapshotCoreManifest({'\udc00':1}),/invalid browser core Wasm manifest serialization/);
});
