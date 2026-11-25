// Host manifest snapshot budget and ownership tests, not browser guest execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotCoreManifest} from '../src/core-manifest-snapshot.mjs';

test('aggregate UTF-8 byte budgets count keys and multibyte values exactly',()=>{
 const inside={p:'é'.repeat(2047)};
 const accepted=snapshotCoreManifest(inside);
 assert.equal(accepted.p.length,2047);
 assert.equal(Object.isFrozen(accepted),true);
 assert.throws(()=>snapshotCoreManifest({p:'é'.repeat(2048)}),/serialization/);
 const key='界'.repeat(100);
 assert.equal(snapshotCoreManifest({[key]:'a'} )[key],'a');
 assert.throws(()=>snapshotCoreManifest({first:'a'.repeat(4090),second:'z'}),/serialization/);
});

test('exact nested depth and repeated shared identities are bounded independently',()=>{
 const nested=depth=>{let value='leaf';for(let i=0;i<depth;i++)value={child:value};return value};
 assert.equal(snapshotCoreManifest(nested(5)).child.child.child.child.child,'leaf');
 assert.throws(()=>snapshotCoreManifest(nested(6)),/serialization/);
 const ref={identity:'shared'};
 assert.throws(()=>snapshotCoreManifest({left:ref,right:ref}),/serialization/);
 const copies=snapshotCoreManifest({left:{identity:'shared'},right:{identity:'shared'}});
 assert.equal(copies.left.identity,'shared');
});

test('node budgets count every array element even where no JSON object is allocated',()=>{
 const allowed=Array.from({length:31},()=>[1,2,3]);
 assert.equal(snapshotCoreManifest(allowed).length,31);
 const oversized=Array.from({length:32},()=>[1,2,3]);
 assert.throws(()=>snapshotCoreManifest(oversized),/serialization/);
 const sparse=Array(3);sparse[0]=1;sparse[2]=3;
 assert.throws(()=>snapshotCoreManifest(sparse),/serialization/);
});

test('snapshot cannot execute getters, toJSON or mutate caller-owned nested records',()=>{
 let calls=0;
 const nested={v:'original'};
 Object.defineProperty(nested,'secret',{enumerable:true,get(){calls++;throw Error('getter');}});
 assert.throws(()=>snapshotCoreManifest({nested}),/serialization/);
 assert.equal(calls,0);
 const supplied={nested:{text:'before'},arr:[1,2]};
 const copied=snapshotCoreManifest(supplied);
 supplied.nested.text='after';supplied.arr[0]=7;
 assert.equal(copied.nested.text,'before');
 assert.equal(copied.arr[0],1);
 assert.equal(Object.isFrozen(copied.arr),true);
});
