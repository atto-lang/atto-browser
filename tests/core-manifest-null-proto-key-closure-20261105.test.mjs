import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotCoreManifest} from '../src/core-manifest-snapshot.mjs';

// Source-free, host-side manifest snapshot test, not browser guest execution.
test('nested null-prototype data records preserve bounded Unicode values',()=>{
 const detail=Object.create(null);
 Object.defineProperty(detail,'compiler',{value:'Atto 🧪',enumerable:true,writable:true});
 const root=Object.create(null);
 Object.defineProperty(root,'producer',{value:detail,enumerable:true});
 const snapshot=snapshotCoreManifest(root);
 assert.equal(Object.getPrototypeOf(snapshot),null);
 assert.equal(Object.getPrototypeOf(snapshot.producer),null);
 assert.equal(snapshot.producer.compiler,'Atto 🧪');
 detail.compiler='mutated';
 assert.equal(snapshot.producer.compiler,'Atto 🧪');
 assert.equal(Object.isFrozen(snapshot.producer),true);
});
test('identity alias and cycles across separate graph branches are rejected',()=>{
 const shared={name:'same'};
 assert.throws(()=>snapshotCoreManifest({left:shared,right:shared}),/serialization/);
 const root={child:{}};
 root.child.parent=root;
 assert.throws(()=>snapshotCoreManifest(root),/serialization/);
});
test('reject hidden prototype authority and non-data descriptors',()=>{
 for(const magic of ['__proto__','constructor','prototype']){
  const record=Object.create(null);
  Object.defineProperty(record,magic,{value:true,enumerable:true});
  assert.throws(()=>snapshotCoreManifest(record),/serialization/,magic);
 }
 let calls=0;
 const poisoned={};
 Object.defineProperty(poisoned,'token',{enumerable:true,get(){calls++;return 'secret';}});
 assert.throws(()=>snapshotCoreManifest(poisoned),/serialization/);
 assert.equal(calls,0);
});
