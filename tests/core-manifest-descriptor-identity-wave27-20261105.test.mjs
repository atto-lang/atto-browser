// Source-owned host snapshot regression; not browser guest or AOT evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotCoreManifest} from '../src/core-manifest-snapshot.mjs';

test('non-enumerable and accessor-backed manifest data never enter the snapshot',()=>{
  const hidden={visible:true};
  Object.defineProperty(hidden,'secret',{value:'hidden',enumerable:false});
  assert.throws(()=>snapshotCoreManifest(hidden),/manifest serialization/);

  let calls=0;
  const accessor=Object.create(null);
  Object.defineProperty(accessor,'value',{enumerable:true,get(){calls++;return true;}});
  assert.throws(()=>snapshotCoreManifest(accessor),/manifest serialization/);
  assert.equal(calls,0,'reject accessors without invoking caller code');
  assert.throws(()=>snapshotCoreManifest([true,,false]),/manifest serialization/);
});

test('snapshot detaches nested arrays and freezes every returned node',()=>{
  const input={config:{flags:[true,false],name:'stable'}};
  const owned=snapshotCoreManifest(input);
  input.config.flags[0]=false;
  input.config.name='changed';
  assert.deepEqual(owned.config.flags,[true,false]);
  assert.equal(owned.config.name,'stable');
  assert.equal(Object.isFrozen(owned),true);
  assert.equal(Object.isFrozen(owned.config),true);
  assert.equal(Object.isFrozen(owned.config.flags),true);
  assert.throws(()=>{owned.config.flags[0]=false;},TypeError);
});

test('numeric ambiguity and unpaired Unicode cannot change wire identity',()=>{
  for(const value of [-0,Number.NaN,Infinity,-Infinity,Number.MAX_SAFE_INTEGER+1])
    assert.throws(()=>snapshotCoreManifest({value}),/manifest serialization/);
  for(const key of ['__proto__','prototype','constructor','\u202e','bad\ud800']){
    const original=Object.create(null);
    Object.defineProperty(original,key,{enumerable:true,value:'x'});
    assert.throws(()=>snapshotCoreManifest(original),/manifest serialization/);
  }
});
