import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotCoreManifest} from '../src/core-manifest-snapshot.mjs';

test('a shared nested record cannot be laundered through two manifest paths',()=>{
 const same={source:'compiler'};
 assert.throws(()=>snapshotCoreManifest({left:same,right:same}),/serialization/);
 const copy=snapshotCoreManifest({left:{source:'compiler'},right:{source:'compiler'}});
 assert.equal(copy.left.source,'compiler');
 assert.equal(copy.right.source,'compiler');
 assert.notEqual(copy.left,copy.right);
});

test('a circular manifest alias is refused before guest work',()=>{
 const outer={id:'guest'};
 outer.self=outer;
 assert.throws(()=>snapshotCoreManifest(outer),/serialization/);
});

test('manifest array copy denies a hostile custom iterator without invoking it',()=>{
 let calls=0;
 const original=['a'];
 Object.defineProperty(original,Symbol.iterator,{value:function*(){
  calls++;throw Error('unexpected iterator');
 }});
 assert.throws(()=>snapshotCoreManifest({items:original}),/serialization/);
 assert.equal(calls,0);
 const good=snapshotCoreManifest({items:['a','b']});
 assert.equal(Object.isFrozen(good.items),true);
 assert.deepEqual(good.items,['a','b']);
});

test('snapshot ownership survives mutation after manifest admission',()=>{
 const source={items:[{name:'alpha'}]};
 const owned=snapshotCoreManifest(source);
 source.items[0].name='forged';
 source.items.push({name:'injected'});
 assert.equal(owned.items[0].name,'alpha');
 assert.equal(owned.items.length,1);
 assert.equal(Object.isFrozen(owned.items[0]),true);
});
