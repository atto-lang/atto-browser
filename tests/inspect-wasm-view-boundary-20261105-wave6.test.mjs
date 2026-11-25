import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectWasmBytes} from '../src/inspect.mjs';

const header = [0,97,115,109,1,0,0,0];

test('DataView offset is pinned to its own 8-byte slice, not surrounding storage', () => {
  const backing = Uint8Array.from([255,255,...header,255,255]);
  const view = new DataView(backing.buffer, 2, 8);
  const owned = inspectWasmBytes(view, {maxModuleBytes:8});
  assert.deepEqual(Array.from(owned.bytes),header);
  assert.notStrictEqual(owned.bytes.buffer,view.buffer);
  backing[2] = 13;
  assert.equal(owned.bytes[0],0);
});

test('Uint8Array snapshots ignore an attacker-supplied Symbol.iterator', () => {
  const view = Uint8Array.from(header);
  let iteratorCalls = 0;
  Object.defineProperty(view, Symbol.iterator,{get(){iteratorCalls++;throw Error('not trusted');}});
  const inspected=inspectWasmBytes(view,{maxModuleBytes:8});
  assert.deepEqual(Array.from(inspected.bytes),header);
  assert.equal(iteratorCalls,0);
});

test('oversized backing storage does not widen a bounded subview', () => {
  const bytes = new Uint8Array(8192);
  bytes.set(header, 4000);
  const view = bytes.subarray(4000,4008);
  assert.deepEqual(Array.from(inspectWasmBytes(view,{maxModuleBytes:8}).bytes),header);
  assert.throws(()=>inspectWasmBytes(bytes,{maxModuleBytes:8}),/maximum byte size/);
});
