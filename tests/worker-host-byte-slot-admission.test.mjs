import test from "node:test";
import assert from "node:assert/strict";
import {runVerifiedCoreGuestInWorker} from "../src/worker-host.mjs";

// Admission must reject unsafe bytes synchronously, before constructing any
// Worker. Use a factory that makes accidental publication observable.
async function expectPreflightDenial(wasmBytes,pattern,maxModuleBytes=64) {
 let created=0;
 await assert.rejects(async()=>runVerifiedCoreGuestInWorker({
  wasmBytes,manifest:{},maxModuleBytes,
  workerFactory:()=>{created++;throw Error("unexpected Worker construction")}
 }),pattern);
 assert.equal(created,0,"invalid input must allocate zero Workers");
}

test("reject SharedArrayBuffer even when disguised as an ArrayBuffer",async(t)=>{
 if(typeof SharedArrayBuffer!=="function")return t.skip("SharedArrayBuffer unavailable");
 const shared=new SharedArrayBuffer(64);
 Object.setPrototypeOf(shared,ArrayBuffer.prototype);
 try {
  await expectPreflightDenial(shared,/expected Wasm ArrayBuffer or typed array/);
 } finally {
  Object.setPrototypeOf(shared,SharedArrayBuffer.prototype);
 }
});

test("reject SharedArrayBuffer-backed typed view with a spoofed buffer property",async(t)=>{
 if(typeof SharedArrayBuffer!=="function")return t.skip("SharedArrayBuffer unavailable");
 const view=new Uint8Array(new SharedArrayBuffer(64));
 Object.defineProperty(view,"buffer",{value:new ArrayBuffer(64)});
 await expectPreflightDenial(view,/shared memory not admitted/);
});

test("reject SharedArrayBuffer-backed DataView with a spoofed buffer property",async(t)=>{
 if(typeof SharedArrayBuffer!=="function")return t.skip("SharedArrayBuffer unavailable");
 const view=new DataView(new SharedArrayBuffer(64));
 Object.defineProperty(view,"buffer",{value:new ArrayBuffer(64)});
 await expectPreflightDenial(view,/shared memory not admitted/);
});

test("ignore forged view lengths when enforcing the host byte budget",async()=>{
 const view=new Uint8Array(128);
 Object.defineProperty(view,"byteLength",{value:1});
 await expectPreflightDenial(view,/Wasm module exceeds host byte budget/,64);
});

test("reject an object inheriting ArrayBuffer.prototype without an ArrayBuffer slot",async()=>{
 const forged=Object.create(ArrayBuffer.prototype);
 await expectPreflightDenial(forged,/expected Wasm ArrayBuffer or typed array/);
});
