import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotCoreManifest} from '../src/core-manifest-snapshot.mjs';

test('nested snapshot is frozen, null-prototype and detached from caller writes',()=>{
  const input={alpha:{rows:[{flag:true},3]},note:'safe'};
  const result=snapshotCoreManifest(input);
  assert.equal(Object.getPrototypeOf(result),null);
  assert.equal(Object.isFrozen(result),true);
  assert.equal(Object.isFrozen(result.alpha),true);
  assert.equal(Object.isFrozen(result.alpha.rows),true);
  assert.equal(Object.isFrozen(result.alpha.rows[0]),true);
  input.alpha.rows[0].flag=false;input.alpha.rows.push(5);
  assert.equal(result.alpha.rows[0].flag,true);
  assert.equal(result.alpha.rows.length,2);
});
test('malicious getter never executes and cycles are rejected',()=>{
  let count=0;const payload={};
  Object.defineProperty(payload,'evil',{enumerable:true,get(){count++;return 'oops'}});
  assert.throws(()=>snapshotCoreManifest(payload),/invalid browser core Wasm manifest/);
  assert.equal(count,0);
  const cyclic={};cyclic.self=cyclic;
  assert.throws(()=>snapshotCoreManifest(cyclic),/invalid browser core Wasm manifest/);
});
test('UTF-8 4096-byte budget includes astral characters',()=>{
  assert.equal(snapshotCoreManifest('a'.repeat(4096)).length,4096);
  assert.throws(()=>snapshotCoreManifest('a'.repeat(4097)),/invalid browser core Wasm manifest/);
  const emojis='😀'.repeat(1024);
  assert.equal(snapshotCoreManifest(emojis),emojis);
  assert.throws(()=>snapshotCoreManifest('😀'.repeat(1025)),/invalid browser core Wasm manifest/);
});
