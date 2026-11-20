import test from 'node:test';
import assert from 'node:assert/strict';
import {loadOreslangWasm} from '../src/loader.mjs';
const invalidWasm=Uint8Array.of(7,7,7,7);

test('missing host grant is denied before hostile or invalid Wasm bytes are inspected',async()=>{
  let called=0;
  await assert.rejects(()=>loadOreslangWasm(invalidWasm,{
    requestedCapabilities:['clock'],grantedCapabilities:[],
    host:{clockMs(){called++;throw Error('must not run')}}
  }),/capability not granted by host: clock/);
  assert.equal(called,0);
});

test('unsupported and repeated capabilities are denied before module parsing',async()=>{
  for(const field of ['requestedCapabilities','grantedCapabilities']){
    for(const list of [['clock','clock'],['fs'],['clock',42]]){
      const options={requestedCapabilities:[],grantedCapabilities:[],[field]:list};
      await assert.rejects(()=>loadOreslangWasm(invalidWasm,options),/unique list/);
    }
  }
});

test('sparse capability arrays cannot be mistaken for an empty grant',async()=>{
  for(const field of ['requestedCapabilities','grantedCapabilities']){
    const sparse=new Array(1);
    const options={requestedCapabilities:[],grantedCapabilities:[],[field]:sparse};
    await assert.rejects(()=>loadOreslangWasm(invalidWasm,options),/unique list/);
  }
});
