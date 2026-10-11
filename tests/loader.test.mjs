import test from "node:test";
import assert from "node:assert/strict";
import {loadOreslangWasm} from "../src/loader.mjs";
// Real Wasm binary compiled with Clang wasm32 from a C function that imports
// ores_host.clock_ms and exports run_clock; no guest Oreslang lowering.
const bytes=Uint8Array.from(Buffer.from("AGFzbQEAAAABBQFgAAF8AhYBCW9yZXNfaG9zdAhjbG9ja19tcwAAAwIBAAUDAQACBggBfwFBgIgECwcWAgZtZW1vcnkCAAlydW5fY2xvY2sAAQoKAQgAEICAgIAACwBABG5hbWUAEA9vcmVzX2Nsb2NrLndhc20BEwIABWNsb2NrAQlydW5fY2xvY2sHEgEAD19fc3RhY2tfcG9pbnRlcgB/CXByb2R1Y2VycwEMcHJvY2Vzc2VkLWJ5AQVjbGFuZ18xNy4wLjAgKGh0dHBzOi8vZ2l0aHViLmNvbS9zd2lmdGxhbmcvbGx2bS1wcm9qZWN0LmdpdCAxMDk5OWI2ZDAzNGZlMzE4ZjNkNTZjODNiZGRiNjU3MjU5M2E4YmIwKQBJD3RhcmdldF9mZWF0dXJlcwQrCm11bHRpdmFsdWUrD211dGFibGUtZ2xvYmFscysPcmVmZXJlbmNlLXR5cGVzKwhzaWduLWV4dA==","base64"));
const config={requestedCapabilities:["clock"],grantedCapabilities:["clock"],host:{clockMs:()=>42},requireRuntimeABI:false};
test("loaded Wasm fixture is real and has only pinned host import",()=>{
 assert.equal(WebAssembly.validate(bytes),true);
 const module=new WebAssembly.Module(bytes);
 assert.deepEqual(WebAssembly.Module.imports(module).map(x=>x.module+"."+x.name),["ores_host.clock_ms"]);
});
test("explicit request, grant and host provider enable clock",async()=>{
 const rt=await loadOreslangWasm(bytes,config);
 assert.equal(rt.instance.exports.run_clock(),42);
 assert.equal(rt.hostClockCalls,1);
});
test("missing grant denies module before instantiation",async()=>{
 await assert.rejects(()=>loadOreslangWasm(bytes,{...config,grantedCapabilities:[]}),/not granted/);
});
test("denied import traps even when module is loadable",async()=>{
 const rt=await loadOreslangWasm(bytes,{...config,requestedCapabilities:[]});
 assert.throws(()=>rt.instance.exports.run_clock(),/clock capability denied/);
 assert.equal(rt.hostClockCalls,0);
});
test("no implicit clock provider supplied",async()=>{
 await assert.rejects(()=>loadOreslangWasm(bytes,{...config,host:{}}),/provider/);
});
test("unsupported capability, duplicates and invalid input fail closed",async()=>{
 for(const change of [{requestedCapabilities:["fs.read"]},{grantedCapabilities:["clock","clock"]}]){
  await assert.rejects(()=>loadOreslangWasm(bytes,{...config,...change}),/unique list/);
 }
 await assert.rejects(()=>loadOreslangWasm("not wasm",config),/expected a Wasm/);
});
test("unknown modules or import names are rejected",async()=>{
 const bad=new Uint8Array(bytes);
 const ascii=new TextEncoder();
 const from=ascii.encode("ores_host"),to=ascii.encode("evil_host");
 let found=false;
 for(let i=0;i<bad.length-from.length;i++){
  if(from.every((v,j)=>bad[i+j]===v)){bad.set(to,i);found=true;break}
 }
 assert.equal(found,true);
 assert.equal(WebAssembly.validate(bad),true);
 await assert.rejects(()=>loadOreslangWasm(bad,config),/unauthorized Wasm import/);
});
test("non-Oreslang guest cannot spoof full runtime ABI",async()=>{
 await assert.rejects(()=>loadOreslangWasm(bytes,{...config,requireRuntimeABI:true}),/ABI version/);
});
