import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotCoreManifest} from '../src/core-manifest-snapshot.mjs';

test('zero-width format keys are forbidden even when hidden in nested records',()=>{
  for(const cp of [0x200b,0x200c,0x200d,0x2060,0xfeff]){
    const key='source'+String.fromCodePoint(cp)+'Hash';
    const record=Object.create(null);
    Object.defineProperty(record,key,{value:'forged',enumerable:true});
    assert.throws(()=>snapshotCoreManifest(record),/serialization/,key);
    assert.throws(()=>snapshotCoreManifest({producer:{nested:[record]}}),
      /serialization/,key);
  }
});

test('ordinary multilingual manifest keys preserve spelling and deep frozen values',()=>{
  const original={'源':'编译器',café:{'名称':'源文件',ids:['ready','🌍']}};
  const copy=snapshotCoreManifest(original);
  assert.equal(copy['源'],'编译器');
  assert.equal(copy.café['名称'],'源文件');
  assert.equal(copy.café.ids[1],'🌍');
  assert.equal(Object.isFrozen(copy),true);
  assert.equal(Object.isFrozen(copy.café),true);
  assert.equal(Object.isFrozen(copy.café.ids),true);
  original.café.ids[1]='changed';
  original.café['名称']='forged';
  assert.equal(copy.café.ids[1],'🌍');
  assert.equal(copy.café['名称'],'源文件');
});

test('manifest snapshot refuses inherited or symbolic authority without getter evaluation',()=>{
  const inherited=Object.assign(Object.create({secret:'admin'}),{value:1});
  let calls=0;
  const getter={value:1};
  Object.defineProperty(getter,'permit',{enumerable:true,get(){
    calls++;throw Error('getter executed');
  }});
  assert.throws(()=>snapshotCoreManifest(getter),/serialization/);
  assert.equal(calls,0);
  assert.throws(()=>snapshotCoreManifest({nested:inherited}),/serialization/);
  assert.throws(()=>snapshotCoreManifest({nested:{[Symbol('admin')]:true}}),
    /serialization/);
});
