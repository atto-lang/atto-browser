// Real browser E2E: runs unchanged Oreslang module Worker in Chromium and Firefox.
// Playwright is a CI-only dependency. No synthetic Worker shims are used.
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {readFile} from "node:fs/promises";
import {resolve,sep,extname} from "node:path";
import {fileURLToPath} from "node:url";
import {chromium,firefox} from "playwright";

const root=resolve(fileURLToPath(new URL("..",import.meta.url)));
const server=createServer(async(request,response)=>{
 try {
  const pathname=decodeURIComponent(new URL(request.url,"http://localhost").pathname);
  if(pathname==="/"){
   response.writeHead(200,{"content-type":"text/html; charset=utf-8",
     "cache-control":"no-store"});
   response.end("<!doctype html><html><head><title>Oreslang real Worker E2E</title></head><body></body></html>");
   return;
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
   const result=await page.evaluate(async()=>{
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
    try{await run({wasmBytes:good,manifest:getter});throw Error("getter manifest admitted")}
    catch(e){if(!/manifest serialization/.test(String(e)))throw e}
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
    return {workerKind:"real browser module Worker",result:value.toString(),
      parallelRuns:series.length,rejectCases:5,timeoutTerminated:true,
      mainThreadTicks:ticks,recovered:recovered.toString()};
   });
   assert.deepEqual(result.result,"42");
   assert.equal(result.timeoutTerminated,true);
   process.stdout.write("PASS "+label+" "+JSON.stringify(result)+"\n");
  }catch(error){
   failCount++;
   process.stderr.write("FAIL "+label+": "+(error?.stack||String(error))+"\n");
  }finally{await browser?.close()}
 }
}finally{await new Promise(resolve=>server.close(resolve))}
if(failCount)process.exitCode=1;
