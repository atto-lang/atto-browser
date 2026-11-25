import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotCoreManifest} from '../src/core-manifest-snapshot.mjs';

test('manifest accepts safe signed numbers but rejects lossy or nonfinite authority',()=>{
 const ok=snapshotCoreManifest({max:Number.MAX_SAFE_INTEGER,min:Number.MIN_SAFE_INTEGER,fraction:1.5});
 assert.equal(ok.max,Number.MAX_SAFE_INTEGER);
 assert.equal(ok.min,Number.MIN_SAFE_INTEGER);
 for(const n of [-0,Number.MAX_SAFE_INTEGER+1,Number.MIN_SAFE_INTEGER-1,Infinity,-Infinity,NaN])
  assert.throws(()=>snapshotCoreManifest({revision:n}),/invalid browser core Wasm manifest serialization/);
});
test('aggregate manifest text quota admits exactly 4096 UTF-16 units',()=>{
 const accepted=snapshotCoreManifest({x:'a'.repeat(4095)});
 assert.equal(accepted.x.length,4095);
 assert.throws(()=>snapshotCoreManifest({x:'a'.repeat(4096)}),/invalid browser core Wasm manifest serialization/);
 assert.throws(()=>snapshotCoreManifest({a:'a'.repeat(2048),b:'b'.repeat(2047)}),/invalid browser core Wasm manifest serialization/);
});
test('snapshot freezes nested data and rejects cycles before JSON serialization',()=>{
 const source={id:'m',items:[{version:1}]},saved=snapshotCoreManifest(source);
 source.items[0].version=2;source.id='changed';
 assert.equal(saved.id,'m');
 assert.equal(saved.items[0].version,1);
 assert.equal(Object.isFrozen(saved),true);
 assert.equal(Object.isFrozen(saved.items[0]),true);
 const cycle={};cycle.self=cycle;
 assert.throws(()=>snapshotCoreManifest(cycle),/invalid browser core Wasm manifest serialization/);
});