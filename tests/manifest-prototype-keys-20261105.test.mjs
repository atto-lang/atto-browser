import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotCoreManifest} from '../src/core-manifest-snapshot.mjs';

test('prototype-magic own keys are denied in nested null-prototype records',()=>{
  for(const key of ['__proto__','prototype','constructor']){
    const record=Object.create(null);
    Object.defineProperty(record,key,{value:1,enumerable:true});
    assert.throws(()=>snapshotCoreManifest({outer:[record]}),
      /invalid browser core Wasm manifest serialization/,key);
  }
});

test('ordinary similar key spellings and null-prototype snapshots remain usable',()=>{
  const record=Object.create(null);
  record.constructor_type='safe';
  record.prototype_name='safe';
  const result=snapshotCoreManifest({outer:[record]});
  assert.equal(result.outer[0].constructor_type,'safe');
  assert.equal(result.outer[0].prototype_name,'safe');
  assert.equal(Object.getPrototypeOf(result.outer[0]),null);
  assert.ok(Object.isFrozen(result.outer[0]));
});
