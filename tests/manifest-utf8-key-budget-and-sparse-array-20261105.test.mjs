import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotCoreManifest} from '../src/core-manifest-snapshot.mjs';

const key=i=>'k'+String(i).padStart(2,'0')+'x'.repeat(125);
test('32 own manifest keys totaling exactly 4096 UTF-8 bytes are admitted',()=>{
  const record={};
  for(let i=0;i<32;i++)record[key(i)]=i;
  const snapshot=snapshotCoreManifest(record);
  assert.equal(Object.keys(snapshot).length,32);
  assert.equal(Object.getPrototypeOf(snapshot),null);
  assert.equal(Object.isFrozen(snapshot),true);
});
test('one additional UTF-8 byte in a key fails the cumulative budget',()=>{
  const record={};
  for(let i=0;i<31;i++)record[key(i)]=i;
  record[key(31).slice(0,-1)+'é']=31;
  assert.throws(()=>snapshotCoreManifest(record),/serialization/);
});
test('32 dense array elements are admitted but 33 or holes are refused',()=>{
  const dense=Array.from({length:32},(_,i)=>i);
  assert.equal(snapshotCoreManifest(dense).length,32);
  assert.throws(()=>snapshotCoreManifest([...dense,33]),/serialization/);
  const sparse=Array.from({length:32},(_,i)=>i);
  delete sparse[17];
  assert.throws(()=>snapshotCoreManifest(sparse),/serialization/);
});
test('getters never execute when array slots are untrusted',()=>{
  const a=[1,2];
  let calls=0;
  Object.defineProperty(a,'1',{enumerable:true,get(){calls++;throw Error('poisoned');}});
  assert.throws(()=>snapshotCoreManifest(a),/serialization/);
  assert.equal(calls,0);
});