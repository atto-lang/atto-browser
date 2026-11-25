import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotCoreManifest} from '../src/core-manifest-snapshot.mjs';
const rejects=value=>assert.throws(()=>snapshotCoreManifest(value),/invalid browser core Wasm manifest serialization/);

test('reject cycles and repeated aliases instead of serializing shared authority',()=>{
  const cycle={id:'a'};cycle.back=cycle;
  rejects(cycle);
  const shared={id:1};
  rejects({first:shared,second:shared});
});

test('reject getters without invoking them, including array index accessors',()=>{
  let calls=0;
  const o={};Object.defineProperty(o,'token',{enumerable:true,get(){calls++;return 'secret';}});
  rejects(o);
  const a=[1];Object.defineProperty(a,'0',{enumerable:true,get(){calls++;return 1;}});
  rejects(a);
  assert.equal(calls,0);
});

test('a frozen snapshot remains independent from nested caller mutation',()=>{
  const input={rows:[{value:1}],name:'ok'};
  const copy=snapshotCoreManifest(input);
  input.rows[0].value=99;input.name='changed';
  assert.equal(copy.rows[0].value,1);
  assert.equal(copy.name,'ok');
  assert.equal(Object.getPrototypeOf(copy),null);
  assert.ok(Object.isFrozen(copy));
  assert.ok(Object.isFrozen(copy.rows));
  assert.ok(Object.isFrozen(copy.rows[0]));
});

test('reject lone surrogates but preserve legitimate non-ASCII text',()=>{
  rejects({name:'\ud800'});
  const copy=snapshotCoreManifest({name:'🚀'});
  assert.equal(copy.name,'🚀');
});
