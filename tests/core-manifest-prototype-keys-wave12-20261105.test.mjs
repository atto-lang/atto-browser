import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotCoreManifest} from '../src/core-manifest-snapshot.mjs';
const invalid=/invalid browser core Wasm manifest serialization/;

test('prototype-magic keys fail even when supplied by null-prototype records',()=>{
 for(const key of ['constructor','prototype','__proto__']){
  const input=Object.create(null);input[key]=1;
  assert.throws(()=>snapshotCoreManifest(input),invalid,key);
 }
});
test('format and line-separator Unicode authority keys cannot enter snapshot',()=>{
 for(const key of ['x\u200b','x\u202e','x\u2028','x\u2029']){
  const input=Object.create(null);input[key]=true;
  assert.throws(()=>snapshotCoreManifest(input),invalid,key);
 }
});
test('frozen null-prototype nested snapshot is detached from original mutations',()=>{
 const input={settings:{ready:true},numbers:[1,2]};
 const copy=snapshotCoreManifest(input);
 input.settings.ready=false;input.numbers[0]=9;
 assert.equal(copy.settings.ready,true);
 assert.equal(copy.numbers[0],1);
 assert.equal(Object.getPrototypeOf(copy),null);
 assert.equal(Object.getPrototypeOf(copy.settings),null);
 assert.equal(Object.isFrozen(copy.settings),true);
 assert.equal(Object.isFrozen(copy.numbers),true);
});
test('symbol fields and noncanonical negative zero do not create hidden authority',()=>{
 const symbolInput={ready:true};symbolInput[Symbol('hidden')]=true;
 assert.throws(()=>snapshotCoreManifest(symbolInput),invalid);
 for(const number of [-0,NaN,Infinity,-Infinity,Number.MAX_SAFE_INTEGER+1])
  assert.throws(()=>snapshotCoreManifest({number}),invalid);
});
