import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotCoreManifest} from '../src/core-manifest-snapshot.mjs';

const nestedArrays=last=>[
  Array(32).fill(0),Array(32).fill(0),Array(32).fill(0),Array(last).fill(0)
];
const nestedObject=depth=>{
  let value=1;
  for(let i=0;i<depth;i++)value={inner:value};
  return value;
};

test('manifest node ceiling admits exactly 128 nodes and rejects node 129',()=>{
  assert.equal(snapshotCoreManifest(nestedArrays(27)).length,4);
  assert.throws(()=>snapshotCoreManifest(nestedArrays(28)),/serialization/);
});

test('each array admits 32 dense entries but not 33',()=>{
  assert.equal(snapshotCoreManifest(Array(32).fill(1)).length,32);
  assert.throws(()=>snapshotCoreManifest(Array(33).fill(1)),/serialization/);
});

test('nested object depth is bounded to five edges',()=>{
  assert.equal(snapshotCoreManifest(nestedObject(5)).inner.inner.inner.inner.inner,1);
  assert.throws(()=>snapshotCoreManifest(nestedObject(6)),/serialization/);
});

test('UTF-16 text-unit budget counts both field names and string values',()=>{
  assert.equal(snapshotCoreManifest('x'.repeat(4096)).length,4096);
  assert.throws(()=>snapshotCoreManifest('x'.repeat(4097)),/serialization/);
  assert.equal(snapshotCoreManifest({x:'a'.repeat(4095)}).x.length,4095);
  assert.throws(()=>snapshotCoreManifest({x:'a'.repeat(4096)}),/serialization/);
});

test('maximum 32 object keys cannot be bypassed through a non-array record',()=>{
  const accepted=Object.fromEntries(Array.from({length:32},(_,i)=>['k'+i,0]));
  assert.equal(Object.keys(snapshotCoreManifest(accepted)).length,32);
  accepted.k32=0;
  assert.throws(()=>snapshotCoreManifest(accepted),/serialization/);
});
