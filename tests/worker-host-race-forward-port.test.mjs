import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {runVerifiedCoreGuestInWorker} from "../src/worker-host.mjs";

const section=(id,body)=>[id,body.length,...body],name=s=>[s.length,...new TextEncoder().encode(s)];
const wasm=Uint8Array.from([0,97,115,109,1,0,0,0,
 ...section(1,[1,0x60,0,1,0x7e]),...section(3,[1,0]),
 ...section(5,[1,1,2,2]),...section(7,[2,...name("main"),0,0,...name("memory"),2,0]),
 ...section(10,[1,4,0,0x42,42,0x0b])]);
const h=createHash("sha256").update(wasm).digest("hex");
const manifest={schemaVersion:1,artifactType:"oreslang.core-wasm.i64-v1",
 target:"wasm32",environment:"browser",backend:"wasm",entry:"main",
 wasmSha256:h,wasmBytes:wasm.length,imports:[],requiredCapabilities:[],
 memory:{maximumPages:2},producer:{compilerSha256:h,sourceSha256:h,llvmIrSha256:h}};

test("abort during trusted Worker construction never publishes guest bytes",async()=>{
 const controller=new AbortController();
 let terminations=0,published=0;
 const listeners=new Map();
 const workerFactory=()=>{
  controller.abort();
  return {
   addEventListener(kind,cb){listeners.set(kind,cb)},
   removeEventListener(kind){listeners.delete(kind)},
   postMessage(){published++},
   terminate(){terminations++}
  };
 };
 await assert.rejects(
  runVerifiedCoreGuestInWorker({wasmBytes:wasm,manifest,
    workerFactory,signal:controller.signal,timeoutMs:100}),
  /aborted/);
 assert.equal(published,0,"cancelled Worker must never receive guest source");
 assert.equal(terminations,1,"cancelled Worker must be torn down exactly once");
 assert.equal(listeners.size,0,"event handlers must be retired on cancellation");
});
