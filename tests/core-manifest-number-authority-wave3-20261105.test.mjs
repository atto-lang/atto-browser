import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotCoreManifest} from '../src/core-manifest-snapshot.mjs';

const reject=value=>assert.throws(()=>snapshotCoreManifest(value),/invalid browser core Wasm manifest serialization/);

test('finite safe numeric values are preserved without coercion or rounding',()=>{
  const input={min:-Number.MAX_SAFE_INTEGER,max:Number.MAX_SAFE_INTEGER,fraction:0.25,zero:0};
  const copy=snapshotCoreManifest(input);
  for(const key of Object.keys(input))assert.equal(copy[key],input[key]);
  assert.equal(Object.getPrototypeOf(copy),null);
  assert.ok(Object.isFrozen(copy));
});

test('NaN, infinities, negative zero and unsafe integers cannot enter nested manifests',()=>{
  for(const value of [NaN,Infinity,-Infinity,-0,Number.MAX_SAFE_INTEGER+1,-(Number.MAX_SAFE_INTEGER+1)]){
    reject({meta:{value}});
    reject([{value}]);
  }
});

test('negative zero in arrays is denied while positive zero remains valid',()=>{
  reject([0,-0]);
  const value=snapshotCoreManifest([0,0.5,1]);
  assert.deepEqual(value,[0,0.5,1]);
  assert.ok(Object.isFrozen(value));
});
