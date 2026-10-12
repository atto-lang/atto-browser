// Real browser E2E: runs unchanged Oreslang module Worker in Chromium and Firefox.
// Playwright is a CI-only dependency. No synthetic Worker shims are used.
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {readFile} from "node:fs/promises";
import {resolve,sep,extname} from "node:path";
import {fileURLToPath} from "node:url";
import {chromium,firefox} from "playwright";

const root=resolve(fileURLToPath(new URL("..",import.meta.url)));
const compiledWasm=process.env.ORESLANG_COMPILED_WASM;
const compiledManifest=process.env.ORESLANG_COMPILED_MANIFEST;
const requireCompiled=process.env.ORESLANG_REQUIRE_COMPILED==="1";
if(Boolean(compiledWasm)!==Boolean(compiledManifest)||
   (requireCompiled&&(!compiledWasm||!compiledManifest||
     !/^[a-f0-9]{64}$/.test(process.env.ORESLANG_EXPECTED_COMPILER_SHA256||"")||
     !/^[a-f0-9]{64}$/.test(process.env.ORESLANG_EXPECTED_SOURCE_SHA256||"")))){
 throw Error("real compiled Oreslang E2E requires binary, manifest and pinned source/compiler SHA-256");
}

const server=createServer(async(request,response)=>{
 try {
  const pathname=decodeURIComponent(new URL(request.url,"http://localhost").pathname);
  if(pathname==="/"){
   response.writeHead(200,{"content-type":"text/html; charset=utf-8",
     "cache-control":"no-store"});
   response.end("<!doctype html><html><head><title>Oreslang real Worker E2E</title></head><body></body></html>");
   return;
  }
  if(compiledWasm&&pathname==="/__compiled/guest.wasm"){
   response.writeHead(200,{"content-type":"application/wasm","cache-control":"no-store"});
   response.end(await readFile(compiledWasm));return;
  }
  if(compiledManifest&&pathname==="/__compiled/guest.artifact.json"){
   response.writeHead(200,{"content-type":"application/json","cache-control":"no-store"});
   response.end(await readFile(compiledManifest));return;
  }
  const file=resolve(root,"."+pathname);
  if(!file.startsWith(root+sep)||extname(file)!==".mjs"){
   response.writeHead(404);response.end("missing");return;
  }
  const bytes=await readFile(file);
  response.writeHead(200,{"content-type":"text/javascript; charset=utf-8",
    "cache-control":"no-store","x-content-type-options":"nosniff"});
  response.end(bytes);
 }catch{response.writeHead(404);response.end("missing")}
});
await new Promise((accept,reject)=>{
 server.once("error",reject);
 server.listen(0,"127.0.0.1",accept);
});
const origin="http://127.0.0.1:"+server.address().port;
const engines=[["chromium",chromium],["firefox",firefox]];
let failCount=0;
try{
 for(const [label,engine] of engines){
  let browser;
  try{
   browser=await engine.launch({headless:true});
   const page=await browser.newPage();
   await page.goto(origin,{waitUntil:"load"});
   page.setDefaultTimeout(30000);
   // Playwright's evaluate() is NOT governed by setDefaultTimeout().
   // A broken/never-settling browser-side Promise must fail this test promptly.
   let watchdog;
   const pending=page.evaluate(async({useCompiled,expectedCompilerSha,expectedSourceSha})=>{
    const NativeWorker=globalThis.Worker;
    if(typeof NativeWorker!=="function")throw Error("native Web Worker unavailable");
    const lifecycle={created:0,terminated:0};
    globalThis.Worker=class AuditedNativeWorker extends NativeWorker{
     constructor(url,options){
      if(options?.type!=="module"||!String(url).includes("/src/guest-worker.mjs"))
       throw Error("guest must use native same-origin module Worker");
      super(url,options);
      lifecycle.created++;
     }
     terminate(){
      lifecycle.terminated++;
      return super.terminate();
     }
    };
    try {
    const {runVerifiedCoreGuestInWorker:run}=await import("/src/worker-host.mjs");
    const section=(id,body)=>[id,body.length,...body];
    const name=s=>[s.length,...new TextEncoder().encode(s)];
    const wasm=(body=[0x42,42],returnType=0x7e)=> {
     const code=[0,...body,0x0b];
     return Uint8Array.from([
      0,97,115,109,1,0,0,0,
      ...section(1,[1,0x60,0,1,returnType]),
      ...section(3,[1,0]),
      ...section(5,[1,1,2,2]),
      ...section(7,[2,...name("main"),0,0,...name("memory"),2,0]),
      ...section(10,[1,code.length,...code])
     ]);
    };
    const sha=async b=>Array.from(new Uint8Array(
      await crypto.subtle.digest("SHA-256",b)),
      x=>x.toString(16).padStart(2,"0")).join("");
    const manifest=async b=>{
     const h=await sha(b);
     return {schemaVersion:1,artifactType:"oreslang.core-wasm.i64-v1",
      target:"wasm32",environment:"browser",backend:"wasm",entry:"main",
      wasmSha256:h,wasmBytes:b.length,imports:[],requiredCapabilities:[],
      memory:{maximumPages:2},producer:{
       compilerSha256:h,sourceSha256:h,llvmIrSha256:h
      }};
    };
    const fail=async (promise,pattern)=>{
     try{await promise;throw Error("unexpectedly admitted invalid input")}
     catch(e){if(!pattern.test(String(e)))throw e}
    };
    const good=wasm();
    if(!WebAssembly.validate(good))throw Error("valid guest rejected by engine");
    const metadata=await manifest(good);
    const value=await run({wasmBytes:good,manifest:metadata,timeoutMs:8000});
    if(value!==42n)throw Error("real Worker returned wrong i64 value");
    // Repeated, separately created real module Workers; per invocation isolation.
    const series=await Promise.all(Array.from({length:5},()=>
     run({wasmBytes:good,manifest:metadata,timeoutMs:8000})));
    if(series.some(x=>x!==42n))throw Error("concurrent Workers returned incorrect result");
    const tainted=good.slice();tainted[tainted.length-2]=43;
    if(!WebAssembly.validate(tainted))throw Error("invalid altered test fixture");
    await fail(run({wasmBytes:tainted,manifest:metadata,timeoutMs:8000}),/execution rejected/);
    await fail(run({wasmBytes:good,manifest:{...metadata,wasmSha256:"0".repeat(64)}}),
      /execution rejected/);
    await fail(run({wasmBytes:good,manifest:{...metadata,memory:{maximumPages:3}}}),
      /execution rejected/);
    await fail(run({wasmBytes:good,manifest:{...metadata,requiredCapabilities:["clock"]}}),
      /execution rejected/);
    const invalidABI=wasm([0x41,42],0x7f);
    if(!WebAssembly.validate(invalidABI))throw Error("i32 negative fixture invalid");
    await fail(run({wasmBytes:invalidABI,manifest:await manifest(invalidABI)}),
      /execution rejected/);
    // Preflight refuses malformed manifest without constructing any Worker.
    const getter={...metadata};
    Object.defineProperty(getter,"wasmSha256",{get(){throw Error("GETTER CALLED")},
     enumerable:true});
    const beforeGetter=lifecycle.created;
    try{await run({wasmBytes:good,manifest:getter});throw Error("getter manifest admitted")}
    catch(e){if(!/manifest serialization/.test(String(e)))throw e}
    if(lifecycle.created!==beforeGetter)
     throw Error("invalid manifest unexpectedly spawned a native Worker");
    const original=good.slice(),mutable=structuredClone(metadata);
    const underway=run({wasmBytes:original,manifest:mutable,timeoutMs:8000});
    original.fill(0);
    mutable.wasmSha256="0".repeat(64);mutable.memory.maximumPages=250;
    if(await underway!==42n)throw Error("caller mutated Worker admission");
    // CPU-bound guest cannot block the main thread and must be terminated.
    // wasm loop { br 0; } followed by an unreachable i64 return.
    const looping=wasm([0x03,0x40,0x0c,0x00,0x0b,0x42,42]);
    if(!WebAssembly.validate(looping))throw Error("infinite-loop test Wasm invalid");
    let ticks=0;
    const timer=setInterval(()=>ticks++,10);
    try{
     await fail(run({wasmBytes:looping,manifest:await manifest(looping),
        timeoutMs:350}),/deadline exceeded/);
    }finally{clearInterval(timer)}
    if(ticks<1)throw Error("Worker blocked browser main thread");
    // Recovery after termination proves subsequent fresh Worker still executes.
    const recovered=await run({wasmBytes:good,manifest:metadata,timeoutMs:8000});
    if(recovered!==42n)throw Error("post-timeout Worker recovery failed");
    let nativeSourceResult=null,expectedWorkerCount=14;
    if(useCompiled){
     const [binaryResponse,manifestResponse]=await Promise.all([
      fetch("/__compiled/guest.wasm",{cache:"no-store"}),
      fetch("/__compiled/guest.artifact.json",{cache:"no-store"})
     ]);
     if(!binaryResponse.ok||!manifestResponse.ok)
      throw Error("real compiled Oreslang artifact not available");
     const compiled=new Uint8Array(await binaryResponse.arrayBuffer());
     const pinnedManifest=await manifestResponse.json();
     if(!WebAssembly.validate(compiled))
      throw Error("real compiled Oreslang Wasm fails engine validation");
     if(pinnedManifest.producer?.compilerSha256!==expectedCompilerSha||
        pinnedManifest.producer?.sourceSha256!==expectedSourceSha)
      throw Error("real LLVM/compiler source SHA-256 does not match pinned provenance");
     if(pinnedManifest.wasmSha256!==await sha(compiled))
      throw Error("real Oreslang compiled Wasm does not match manifest SHA-256");
     const nativeValue=await run({wasmBytes:compiled,manifest:pinnedManifest,timeoutMs:8000});
     if(nativeValue!==42n)throw Error("real compiled Oreslang result not 42n");
     await fail(run({wasmBytes:compiled,
       manifest:{...pinnedManifest,wasmSha256:"0".repeat(64)},
       timeoutMs:8000}),/execution rejected/);
     nativeSourceResult={result:nativeValue.toString(),wasmSha256:pinnedManifest.wasmSha256,
       sourceSha256:pinnedManifest.producer.sourceSha256,
       compilerSha256:pinnedManifest.producer.compilerSha256};
     expectedWorkerCount+=2;
    }

    if(lifecycle.created!==expectedWorkerCount||lifecycle.terminated!==lifecycle.created)
     throw Error("real Worker lifecycle mismatch: "+JSON.stringify(lifecycle));
    return {workerKind:"real browser module Worker",result:value.toString(),
      parallelRuns:series.length,rejectCases:5,timeoutTerminated:true,
      workerCreated:lifecycle.created,workerTerminated:lifecycle.terminated,
      mainThreadTicks:ticks,recovered:recovered.toString(),nativeSourceResult};
    }finally{
     globalThis.Worker=NativeWorker;
    }
   },{useCompiled:Boolean(compiledWasm),
     expectedCompilerSha:process.env.ORESLANG_EXPECTED_COMPILER_SHA256||"",
     expectedSourceSha:process.env.ORESLANG_EXPECTED_SOURCE_SHA256||""});
   let result;
   try{
    result=await Promise.race([
     pending,
     new Promise((_,reject)=>{watchdog=setTimeout(()=>
       reject(Error("browser evaluation exceeded independent 90-second deadline")),90000);})
    ]);
   }finally{clearTimeout(watchdog)}
   assert.deepEqual(result.result,"42");
   assert.equal(result.timeoutTerminated,true);
   assert.equal(result.workerCreated,compiledWasm?16:14);
   assert.equal(result.workerTerminated,compiledWasm?16:14);
   if(requireCompiled){
    assert.equal(result.nativeSourceResult?.result,"42");
    assert.equal(result.nativeSourceResult.sourceSha256,process.env.ORESLANG_EXPECTED_SOURCE_SHA256);
    assert.equal(result.nativeSourceResult.compilerSha256,process.env.ORESLANG_EXPECTED_COMPILER_SHA256);
   }
   process.stdout.write("PASS "+label+" "+JSON.stringify(result)+"\n");
  }catch(error){
   failCount++;
   process.stderr.write("FAIL "+label+": "+(error?.stack||String(error))+"\n");
  }finally{await browser?.close()}
 }
}finally{await new Promise(resolve=>server.close(resolve))}
if(failCount)process.exitCode=1;
