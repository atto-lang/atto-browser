import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotCoreManifest as snapshot} from '../src/core-manifest-snapshot.mjs';
const reject=value=>assert.throws(()=>snapshot(value),/invalid browser core Wasm manifest serialization/);
test('nested arrays become deeply frozen independent snapshots',()=>{
  const original={items:[{value:'alpha'},[1,2,3]]};
  const copy=snapshot(original);
  original.items[0].value='changed';
  original.items[1][0]=9;
  assert.equal(copy.items[0].value,'alpha');
  assert.equal(copy.items[1][0],1);
  assert.ok(Object.isFrozen(copy.items));
  assert.ok(Object.isFrozen(copy.items[0]));
  assert.ok(Object.isFrozen(copy.items[1]));
});
test('sparse arrays and accessor slots fail before user getters execute',()=>{
  reject({items:Array(2)});
  let getterCalls=0;const array=[1];
  Object.defineProperty(array,'0',{enumerable:true,get(){getterCalls++;throw Error('getter');}});
  reject({items:array});
  assert.equal(getterCalls,0);
  const hidden=[1];Object.defineProperty(hidden,'0',{enumerable:false,value:1});
  reject(hidden);
});
test('shared object aliases and cycles are rejected rather than flattened',()=>{
  const nested={value:'a'};
  reject({left:nested,right:nested});
  const cycle={};cycle.self=cycle;
  reject(cycle);
  const proto=Object.create({inherited:'x'});proto.value=1;
  reject(proto);
});
