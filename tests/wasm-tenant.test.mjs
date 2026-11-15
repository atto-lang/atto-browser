import test from 'node:test';
import assert from 'node:assert/strict';
import { open_wasm_tenant } from '../src/wasm-tenant.mjs';
// Wasm binary: () -> i64 main returns 42, with no imports.
const answer=Uint8Array.from(Buffer.from('0061736d010000000105016000017e03020100070801046d61696e00000a06010400422a0b','hex'));
test('real Wasm guest loads and returns 42; call-once prevents reentrancy',async()=>{
  assert.equal(WebAssembly.validate(answer),true);
  const before=globalThis.fetch;
  globalThis.fetch=async()=>({ok:true,arrayBuffer:async()=>answer.buffer.slice(0)});
  try{
    const guest=await open_wasm_tenant('https://example.test/answer.wasm');
    assert.deepEqual(await guest.on_message(),{value:'42',stdout:'',actors:0});
    await assert.rejects(guest.on_message(),/E_MAIN_ALREADY_CALLED/);
  }finally{globalThis.fetch=before;}
});
test('reject invalid Wasm before constructing tenant',async()=>{
  const before=globalThis.fetch;
  globalThis.fetch=async()=>({ok:true,arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer});
  try{await assert.rejects(open_wasm_tenant('https://example.test/invalid.wasm'),/E_WASM_INVALID/)}
  finally{globalThis.fetch=before;}
});

test('actor panic is read from the failing actor, not main Wasm instance',async()=>{
  // Valid guest with an actor type Counter; main spawns it and sends i64=5.
  // actor_receive stores panic_code=7 and traps. Main panic_code stays 0.
  const guest_bytes=Uint8Array.from(Buffer.from('0061736d0100000001190560017f017f60027f7e006000017e60017f0060037f7e7e00022602046174746f0b6163746f725f737061776e0000046174746f0a6163746f725f73656e6400010304030203040504010101010606017f0141000b073b05046d61696e00020a6163746f725f696e697400030d6163746f725f726563656976650004066d656d6f727902000a70616e69635f636f646503000a19030c00410010004205100142000b02000b070041072400000b00150b6174746f2e6163746f72730107436f756e746572','hex'));
  assert.equal(WebAssembly.validate(guest_bytes),true);
  const old_fetch=globalThis.fetch;
  globalThis.fetch=async()=>({ok:true,arrayBuffer:async()=>guest_bytes.buffer.slice(0)});
  try {
    const guest=await open_wasm_tenant('https://example.test/panic-actor.wasm');
    await assert.rejects(guest.on_message(),/E_GUEST_PANIC_7/);
  }finally{globalThis.fetch=old_fetch;}
});
