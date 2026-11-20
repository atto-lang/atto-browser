import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotCoreManifest} from '../src/core-manifest-snapshot.mjs';

test('null-prototype manifest records preserve data and become deeply frozen',()=>{
  const source=Object.assign(Object.create(null),{backend:'wasm',memory:{maximumPages:2}});
  const saved=snapshotCoreManifest(source);
  assert.equal(Object.getPrototypeOf(saved),null);
  assert.equal(Object.getPrototypeOf(saved.memory),null);
  assert.equal(Object.isFrozen(saved),true);
  assert.equal(Object.isFrozen(saved.memory),true);
  source.memory.maximumPages=100;
  assert.equal(saved.memory.maximumPages,2);
});

test('safe signed integers and finite fractions retain exact JS values',()=>{
  for(const number of [0,0.5,-0.5,Number.MAX_SAFE_INTEGER,-Number.MAX_SAFE_INTEGER]){
    const saved=snapshotCoreManifest({number});
    assert.equal(saved.number,number);
  }
});

test('negative zero, nonfinite numbers, and unsafe integers cannot become manifest authority',()=>{
  for(const number of [-0,NaN,Infinity,-Infinity,Number.MAX_SAFE_INTEGER+1]){
    assert.throws(()=>snapshotCoreManifest({number}),/serialization/);
  }
});

test('duplicated manifest subobjects and hostile array iterators are not silently coerced',()=>{
  const shared={id:'core'};
  assert.throws(()=>snapshotCoreManifest({left:shared,right:shared}),/serialization/);
  let calls=0;
  const poisoned=[1];
  Object.defineProperty(poisoned,Symbol.iterator,{value:function*(){
    calls++;throw Error('hostile iterator');
  }});
  assert.throws(()=>snapshotCoreManifest({array:poisoned}),/serialization/);
  assert.equal(calls,0);
});
