import test from 'node:test';
import assert from 'node:assert/strict';
import {loadOreslangWasm as load} from '../src/loader.mjs';

const header=[0,97,115,109,1,0,0,0];
const section=(id,body)=>[id,body.length,...body];
const bytes=()=>Uint8Array.from([...header,
 ...section(1,[1,0x60,0,1,0x7c]),
 ...section(2,[1,9,...new TextEncoder().encode('ores_host'),8,...new TextEncoder().encode('clock_ms'),0,0]),
 ...section(7,[1,4,109,97,105,110,0,0])
]);
const options={requireRuntimeABI:false};

test('the imported clock host function refuses guest calls without an explicit request',async()=>{
 let called=0;
 const loaded=await load(bytes(),{...options,host:{clockMs(){called++;return 17;}}});
 assert.throws(()=>loaded.instance.exports.main(),/clock capability denied/);
 assert.equal(called,0);
 assert.equal(loaded.hostClockCalls,0);
});

test('a clock request without grant is rejected before Wasm instantiation',async()=>{
 await assert.rejects(load(bytes(),{...options,requestedCapabilities:['clock'],
  grantedCapabilities:[],host:{clockMs:()=>12}}),/capability not granted by host: clock/);
});

test('granted clock calls reach a validated provider exactly once per invocation',async()=>{
 let calls=0;
 const loaded=await load(bytes(),{...options,requestedCapabilities:['clock'],
  grantedCapabilities:['clock'],host:{clockMs(){calls++;return 25;}}});
 assert.equal(loaded.hostClockCalls,0);
 assert.equal(loaded.instance.exports.main(),25);
 assert.equal(loaded.instance.exports.main(),25);
 assert.equal(calls,2);
 assert.equal(loaded.hostClockCalls,2);
});

test('duplicate requests, unsupported capabilities and invalid clocks fail closed',async()=>{
 for(const requests of [['clock','clock'],['random']])
  await assert.rejects(load(bytes(),{...options,requestedCapabilities:requests,grantedCapabilities:['clock']}),/unique list of supported capabilities/);
 const loaded=await load(bytes(),{...options,requestedCapabilities:['clock'],
  grantedCapabilities:['clock'],host:{clockMs:()=>NaN}});
 assert.throws(()=>loaded.instance.exports.main(),/finite, nonnegative milliseconds/);
 assert.equal(loaded.hostClockCalls,0);
});
