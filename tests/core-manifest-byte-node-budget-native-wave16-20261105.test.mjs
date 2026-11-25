import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotCoreManifest} from '../src/core-manifest-snapshot.mjs';

test('a 4096-byte well-formed astral string is admitted, 4100 bytes denied',()=>{
  const good='🚀'.repeat(1024);
  assert.equal(snapshotCoreManifest(good),good);
  assert.throws(()=>snapshotCoreManifest(good+'🚀'),/serialization/);
});
test('five nested object edges are admitted but a sixth is refused',()=>{
  const nest=n=>{let x=1;for(let i=0;i<n;i++)x={next:x};return x;};
  let v=snapshotCoreManifest(nest(5));
  for(let i=0;i<5;i++)v=v.next;
  assert.equal(v,1);
  assert.throws(()=>snapshotCoreManifest(nest(6)),/serialization/);
});
test('aggregate node budget applies across sibling arrays',()=>{
  const record=n=>({a:Array(n).fill(0),b:Array(n).fill(1),
    c:Array(n).fill(2),d:Array(n).fill(3)});
  assert.equal(snapshotCoreManifest(record(30)).a.length,30);
  assert.throws(()=>snapshotCoreManifest(record(31)),/serialization/);
});
test('a null-prototype input is deeply detached and frozen',()=>{
  const data=Object.create(null);data.item={name:'ok',active:true};
  const out=snapshotCoreManifest(data);
  data.item.name='changed';
  assert.equal(out.item.name,'ok');
  assert.equal(Object.getPrototypeOf(out),null);
  assert.equal(Object.getPrototypeOf(out.item),null);
  assert.ok(Object.isFrozen(out.item));
});