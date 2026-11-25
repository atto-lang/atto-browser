// Host manifest ownership regression only; not native guest or AOT evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotCoreManifest} from '../src/core-manifest-snapshot.mjs';

test('equal but independently allocated sibling objects remain independent frozen snapshots',()=>{
  const left={name:'same',flags:[true,false]};
  const right={name:'same',flags:[true,false]};
  const input={left,right};
  const result=snapshotCoreManifest(input);
  assert.deepEqual({...result.left},{...result.right});
  assert.notStrictEqual(result.left,result.right);
  assert.equal(Object.getPrototypeOf(result.left),null);
  assert.equal(Object.isFrozen(result.left.flags),true);
  left.flags[0]=false;
  right.name='changed';
  assert.equal(result.left.flags[0],true);
  assert.equal(result.right.name,'same');
});

test('shared source identity cannot masquerade as two independently owned sibling records',()=>{
  const shared={name:'shared'};
  assert.throws(()=>snapshotCoreManifest({left:shared,right:shared}),/serialization/);
  assert.throws(()=>snapshotCoreManifest([shared,shared]),/serialization/);
});

test('distinct null-prototype records are copied without importing inherited authority',()=>{
  const a=Object.assign(Object.create(null),{mode:'read'});
  const b=Object.assign(Object.create(null),{mode:'write'});
  const result=snapshotCoreManifest({a,b});
  assert.equal(result.a.mode,'read');
  assert.equal(result.b.mode,'write');
  assert.equal(Object.getPrototypeOf(result.b),null);
  assert.equal(Object.isFrozen(result),true);
});