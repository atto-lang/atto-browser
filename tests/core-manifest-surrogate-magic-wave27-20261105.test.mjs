// Host manifest admission tests only, not real browser or guest Wasm validation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotCoreManifest} from '../src/core-manifest-snapshot.mjs';

test('prototype magic keys are refused even for null-prototype JSON data',()=>{
  for(const key of ['__proto__','prototype','constructor']) {
    const input=Object.create(null);
    Object.defineProperty(input,key,{value:'bad',enumerable:true});
    assert.throws(()=>snapshotCoreManifest(input),/serialization/);
  }
  const safe=snapshotCoreManifest({type:'core',feature:'worker'});
  assert.equal(Object.getPrototypeOf(safe),null);
  assert.equal(Object.isFrozen(safe),true);
});

test('unpaired Unicode and noncanonical number authority cannot enter a snapshot',()=>{
  for(const bad of ['\uD800','\uDC00','ok\uD800bad','ok\uDC00bad']) {
    assert.throws(()=>snapshotCoreManifest({id:bad}),/serialization/);
  }
  for(const value of [-0,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]) {
    assert.throws(()=>snapshotCoreManifest({value}),/serialization/);
  }
  const valid=snapshotCoreManifest({id:'🐟',value:0});
  assert.equal(valid.id,'🐟');
});

test('getters are not invoked and returned data cannot alias caller mutation',()=>{
  let invocations=0;
  const hostile={};
  Object.defineProperty(hostile,'secret',{enumerable:true,get(){invocations++;return 'x';}});
  assert.throws(()=>snapshotCoreManifest(hostile),/serialization/);
  assert.equal(invocations,0);
  const mutable={nested:['ok']};
  const copy=snapshotCoreManifest(mutable);
  mutable.nested[0]='changed';
  assert.equal(copy.nested[0],'ok');
  assert.equal(Object.isFrozen(copy.nested),true);
});