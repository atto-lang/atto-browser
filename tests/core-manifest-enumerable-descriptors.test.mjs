import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotCoreManifest} from '../src/core-manifest-snapshot.mjs';

const denied=/invalid browser core Wasm manifest serialization/;

test('reject hidden top-level own data keys instead of copying them into trusted manifest',()=>{
  const input={visible:true};
  Object.defineProperty(input,'hidden',{value:'admin',enumerable:false});
  assert.throws(()=>snapshotCoreManifest(input),denied);
});

test('reject hidden nested own data keys at any depth',()=>{
  const nested={visible:true};
  Object.defineProperty(nested,'hidden',{value:'admin',enumerable:false});
  assert.throws(()=>snapshotCoreManifest({meta:{nested}}),denied);
});

test('reject non-enumerable array indices including nested arrays',()=>{
  const array=['a','b'];
  Object.defineProperty(array,'0',{value:'a',enumerable:false});
  assert.throws(()=>snapshotCoreManifest(array),denied);
  assert.throws(()=>snapshotCoreManifest({items:array}),denied);
});

test('deny accessors in object and array descriptors without executing getters',()=>{
  let getterCalls=0;
  const input={};
  Object.defineProperty(input,'danger',{enumerable:true,get(){getterCalls++;throw Error('getter executed');}});
  assert.throws(()=>snapshotCoreManifest(input),denied);
  const array=['value'];
  Object.defineProperty(array,'0',{enumerable:true,get(){getterCalls++;throw Error('array getter executed');}});
  assert.throws(()=>snapshotCoreManifest(array),denied);
  assert.equal(getterCalls,0);
});

test('preserve enumerable data properties, frozen deep copies, and null-prototype manifests',()=>{
  const source={meta:{name:'v1'},flags:[true,false]};
  Object.defineProperty(source.meta,'readonly',{value:'kept',enumerable:true,writable:false});
  const output=snapshotCoreManifest(source);
  source.meta.name='changed';source.flags[0]=false;
  assert.equal(Object.getPrototypeOf(output),null);
  assert.equal(Object.getPrototypeOf(output.meta),null);
  assert.equal(output.meta.name,'v1');
  assert.equal(output.meta.readonly,'kept');
  assert.deepEqual(output.flags,[true,false]);
  assert.equal(Object.isFrozen(output),true);
  assert.equal(Object.isFrozen(output.meta),true);
  assert.equal(Object.isFrozen(output.flags),true);
  const nullProto=Object.assign(Object.create(null),{hello:'world'});
  assert.equal(snapshotCoreManifest(nullProto).hello,'world');
});

test('retain UTF-8 byte budgets, unicode and structural limits',()=>{
  assert.equal(snapshotCoreManifest('🚀'.repeat(1024)).length,2048);
  assert.throws(()=>snapshotCoreManifest('🚀'.repeat(1025)),denied);
  assert.throws(()=>snapshotCoreManifest('\ud800'),denied);
  assert.equal(snapshotCoreManifest(new Array(32).fill(0)).length,32);
  assert.throws(()=>snapshotCoreManifest(new Array(33).fill(0)),denied);
});
