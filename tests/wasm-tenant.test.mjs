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

test('require redirect-error before Wasm guest download and reject redirected responses',async()=>{
  const before=globalThis.fetch;
  const observed=[];
  globalThis.fetch=async(url,options)=>{
    observed.push({url,options});
    return {ok:true,redirected:true,url:'https://outside.example/redirect.wasm',
      arrayBuffer:async()=>{throw new Error('E_SHOULD_NOT_READ_REDIRECT');}};
  };
  try {
    await assert.rejects(open_wasm_tenant('https://app.example/guest.wasm'),/E_WASM_REDIRECT/);
    assert.equal(observed.length,1);
    assert.equal(observed[0].url,'https://app.example/guest.wasm');
    assert.deepEqual(observed[0].options,{credentials:'omit',mode:'same-origin',redirect:'error'});
  }finally{globalThis.fetch=before;}
});

test('actor failures carry metadata from trusted host, not guest Wasm',async()=>{
  const bytes=Uint8Array.from(Buffer.from('0061736d0100000001190560017f017f60027f7e006000017e60017f0060037f7e7e00022602046174746f0b6163746f725f737061776e0000046174746f0a6163746f725f73656e6400010304030203040504010101010606017f0141000b073b05046d61696e00020a6163746f725f696e697400030d6163746f725f726563656976650004066d656d6f727902000a70616e69635f636f646f646503000a19030c00410010004205100142000b02000b070041072400000b00150b6174746f2e6163746f72730107436f756e746572'.replace('636f646f6465','636f6465'),'hex'));
  assert.equal(WebAssembly.validate(bytes),true);
  const old=globalThis.fetch;
  globalThis.fetch=async()=>({ok:true,arrayBuffer:async()=>bytes.buffer.slice(0)});
  try {
    const tenant=await open_wasm_tenant('https://example.test/actor-panic.wasm');
    await assert.rejects(tenant.on_message(),e=>{
      assert.equal(e.message,'E_GUEST_PANIC_7');
      assert.deepEqual(e.actor_failure,{kind:'panic',actor_id:1,parent_id:0,
        actor_type:'Counter',reason:'E_GUEST_PANIC_7'});
      return true;
    });
  }finally{globalThis.fetch=old;}
});

test('a streaming response cannot produce unbounded empty chunks',async()=>{
  const old=globalThis.fetch;
  let reads=0,cancelled=0;
  globalThis.fetch=async()=>({ok:true,body:{getReader:()=>({
    read:async()=>{reads++;return {done:false,value:new Uint8Array(0)}},
    cancel:async()=>{cancelled++}
  })}});
  try {
    await assert.rejects(open_wasm_tenant('https://example.test/stalling.wasm'),/E_WASM_STREAM_CHUNKS/);
    assert.equal(reads,8193);
    assert.equal(cancelled,1);
  }finally{globalThis.fetch=old;}
});
test('many tiny print calls cannot allocate unbounded stdout chunk slots',async()=>{
  const uleb=n=>{const out=[];do{let b=n&127;n=Math.floor(n/128);if(n)b|=128;out.push(b)}while(n);return out};
  const str=s=>{const bytes=new TextEncoder().encode(s);return [...uleb(bytes.length),...bytes]};
  const section=(id,bytes)=>[id,...uleb(bytes.length),...bytes];
  const prints=Array.from({length:8193},()=>[0x10,0x00]).flat();
  const body=[0,...prints,0x42,0x2a,0x0b];
  const wasm=new Uint8Array([
    0,97,115,109,1,0,0,0,
    ...section(1,[2,0x60,0,0,0x60,0,1,0x7e]),
    ...section(2,[1,...str('atto'),...str('print_newline'),0,0]),
    ...section(3,[1,1]),
    ...section(7,[1,...str('main'),0,1]),
    ...section(10,[1,...uleb(body.length),...body])
  ]);
  assert.equal(WebAssembly.validate(wasm),true);
  const old=globalThis.fetch;
  globalThis.fetch=async()=>({ok:true,arrayBuffer:async()=>wasm.buffer});
  try {
    const guest=await open_wasm_tenant('https://example.test/tiny-prints.wasm');
    await assert.rejects(guest.on_message(),/E_STDOUT_CHUNKS/);
  }finally{globalThis.fetch=old;}
});

test('reject valid Wasm exports with the wrong main and actor receiver arity',async()=>{
  // Parameter counts are part of the compiler/browser v2 guest ABI. Merely
  // finding a function export is insufficient: malformed guests must not boot.
  const wrong_main=Buffer.from(
    '0061736d0100000001060160017f017e03020100070801046d61696e00000a06010400422a0b','hex');
  const correct_actor=Buffer.from('0061736d0100000001190560017f017f60027f7e006000017e60017f0060037f7e7e00022602046174746f0b6163746f725f737061776e0000046174746f0a6163746f725f73656e6400010304030203040504010101010606017f0141000b073b05046d61696e00020a6163746f725f696e697400030d6163746f725f726563656976650004066d656d6f727902000a70616e69635f636f646503000a19030c00410010004205100142000b02000b070041072400000b00150b6174746f2e6163746f72730107436f756e746572','hex');
  const wrong_actor=Buffer.from(correct_actor.toString('hex')
    .replace('011905','011805').replace('60037f7e7e00','60027f7e00'),'hex');
  assert.equal(WebAssembly.validate(wrong_main),true);
  assert.equal(WebAssembly.validate(wrong_actor),true);
  const previous=globalThis.fetch;
  try {
    for(const [bytes,reason] of [[wrong_main,/E_WASM_MAIN_SIGNATURE/],
                                  [wrong_actor,/E_WASM_ACTOR_SIGNATURE/]]) {
      globalThis.fetch=async()=>({ok:true,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)});
      await assert.rejects(open_wasm_tenant('https://example.test/wrong-abi.wasm'),reason);
    }
  }finally{globalThis.fetch=previous;}
});
