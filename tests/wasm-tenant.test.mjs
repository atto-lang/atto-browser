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
