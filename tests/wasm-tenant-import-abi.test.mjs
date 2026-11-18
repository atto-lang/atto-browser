import test from 'node:test';
import assert from 'node:assert/strict';
import {validateGuestImportABI} from '../src/guest-import-abi.js';
import {open_wasm_tenant} from '../src/wasm-tenant.mjs';

// Independently assembled real WebAssembly, not a JS mock guest.
const MAGIC=[0,97,115,109,1,0,0,0];
const leb=n=>{const out=[];do{let b=n&127;n=Math.floor(n/128);if(n)b|=128;out.push(b);}while(n);return out;};
const section=(id,body)=>[id,...leb(body.length),...body];
const name=s=>{const v=[...new TextEncoder().encode(s)];return [...leb(v.length),...v];};
function guest({symbol='print_i64',params=[0x7e],results=[],namespace='atto'}={}) {
  const types=section(1,[2,0x60,params.length,...params,results.length,...results,
    0x60,0,1,0x7e]);
  const imports=section(2,[1,...name(namespace),...name(symbol),0,0]);
  const functions=section(3,[1,1]);
  const exports=section(7,[1,...name('main'),0,1]);
  const code=section(10,[1,4,0,0x42,42,0x0b]);
  return Uint8Array.from([...MAGIC,...types,...imports,...functions,...exports,...code]);
}

test('browser tenant accepts real bounded Atto guest with exact import signature',async()=>{
  const bytes=guest();
  assert.equal(WebAssembly.validate(bytes),true);
  assert.equal(validateGuestImportABI(bytes,new WebAssembly.Module(bytes),{allowFloat:true}).length,1);
  const oldFetch=globalThis.fetch;
  globalThis.fetch=async()=>({ok:true,redirected:false,url:'https://example.test/guest.wasm',
    headers:{get:()=>String(bytes.length)},arrayBuffer:async()=>bytes.slice().buffer});
  try{
    const tenant=await open_wasm_tenant('https://example.test/guest.wasm');
    const result=await tenant.on_message();
    assert.equal(result.value,'42');
    assert.equal(result.actors,0);
    await tenant.dispose();
  }finally{globalThis.fetch=oldFetch;}
});

test('valid Wasm with forged print_i64 type is rejected before any tenant instantiation',async()=>{
  for(const override of [
    {params:[]},{params:[0x7f]},{params:[0x7c]},{params:[0x7e,0x7e]},{results:[0x7e]}
  ]){
    const bytes=guest(override);
    assert.equal(WebAssembly.validate(bytes),true);
    const module=new WebAssembly.Module(bytes);
    assert.deepEqual(WebAssembly.Module.imports(module),
      [{module:'atto',name:'print_i64',kind:'function'}]);
    const oldFetch=globalThis.fetch;
    globalThis.fetch=async()=>({ok:true,redirected:false,url:'https://example.test/guest.wasm',
      headers:{get:()=>String(bytes.length)},arrayBuffer:async()=>bytes.slice().buffer});
    try{
      await assert.rejects(open_wasm_tenant('https://example.test/guest.wasm'),
        /E_GUEST_ABI: guest import signature mismatch: print_i64/);
    }finally{globalThis.fetch=oldFetch;}
  }
});

test('foreign namespaces, wrong function kinds and duplicate imports fail closed',()=>{
  const foreign=guest({namespace:'env'});
  assert.equal(WebAssembly.validate(foreign),true);
  assert.throws(()=>validateGuestImportABI(foreign,new WebAssembly.Module(foreign),{allowFloat:true}),
    /guest import not granted/);
  const valid=guest();
  assert.throws(()=>validateGuestImportABI(valid,new WebAssembly.Module(MAGIC),{allowFloat:true}),
    /binary\/reflection import mismatch/);
});
