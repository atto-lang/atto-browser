/**
 * Real-engine browser transport regression.
 * CI installs pinned Playwright and Chromium/Firefox explicitly; this script
 * is separate from Node-shim unit tests and must never be silently skipped.
 * The tested Workers contain transport code only, not compiled actor handlers.
 */
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {readFile} from "node:fs/promises";
import {resolve,dirname,extname,join,relative,sep} from "node:path";
import {fileURLToPath} from "node:url";
import {chromium,firefox} from "playwright";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const runtime=process.env.ORESLANG_WASM_RUNTIME_BINARY
 ? resolve(root,process.env.ORESLANG_WASM_RUNTIME_BINARY):null;
assert.ok(runtime,"ORESLANG_WASM_RUNTIME_BINARY is required (real compiled C ABI Wasm)");
const media={".mjs":"text/javascript;charset=utf-8",".js":"text/javascript;charset=utf-8",
 ".html":"text/html;charset=utf-8",".wasm":"application/wasm"};
function serve(response,code,body){response.writeHead(code,{"Content-Type":code===200?"text/plain":"text/plain"});response.end(body)}
const server=createServer(async(request,response)=>{
 try{
  const url=new URL(request.url,"http://localhost");
  if(url.pathname==="/"){
   response.writeHead(200,{"Content-Type":"text/html;charset=utf-8"});
   response.end("<!doctype html><title>Oreslang Worker conformance</title>");return;
  }
  const file=url.pathname==="/compiled-runtime.wasm"?runtime:
   resolve(root,"."+decodeURIComponent(url.pathname));
  // Keep this local smoke-test server from serving arbitrary paths.
  if(file!==runtime&&(file!==root&&!file.startsWith(root+sep))){
   return serve(response,403,"forbidden");
  }
  const bytes=await readFile(file);
  response.writeHead(200,{"Content-Type":media[extname(file)]||"application/octet-stream",
   "Cache-Control":"no-store","X-Content-Type-Options":"nosniff"});
  response.end(bytes);
 }catch(error){serve(response,404,"not found: "+(error?.code||"invalid path"))}
});
await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve)});
const origin="http://127.0.0.1:"+server.address().port;
try{
 for(const [name,browserType] of [["chromium",chromium],["firefox",firefox]]){
  const browser=await browserType.launch({headless:true});
  try{
   const page=await browser.newPage();
   page.setDefaultTimeout(20000);
   const pageErrors=[];page.on("pageerror",e=>pageErrors.push(String(e)));
   await page.goto(origin+"/");
   const result=await page.evaluate(async()=>{
    const {createActorMessageTransport}=await import("/src/actor-transport.mjs");
    const {encodeActorMessageV2}=await import("/src/messagepack-v2.mjs");
    const {loadOreslangWasm}=await import("/src/loader.mjs");
    const schemaId="example.Compute#variant=1",descriptor="T[S,I]";
    // Real module Worker: FIFO, concurrent send tickets, and CONTROL drain.
    const a=createActorMessageTransport({schemaId,descriptor,capacity:20,
      maxFrameBytes:4096,maxReservedBytes:20*4096,timeoutMs:8000});
    const admitted=await Promise.all(Array.from({length:12},(_,i)=>a.send(["worker",BigInt(i)])));
    await a.drain();
    if(admitted.length!==12||!admitted.every(Boolean)||a.pending!==0||!a.sealed)
      throw Error("real Worker FIFO admission/drain mismatch");

    // A separate real Worker must reject a replay; its first valid DATA gets
    // one acknowledgment, then duplicate ticket produces terminal panic.
    const w=new Worker("/src/actor-message-worker.mjs",{type:"module"});
    const exchange=(data)=>new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{cleanup();reject(Error("Worker message deadline"))},7000);
      const onError=()=>{cleanup();reject(Error("Worker error"))};
      const onMessage=e=>{cleanup();resolve(e.data)};
      function cleanup(){clearTimeout(timer);w.removeEventListener("message",onMessage);
       w.removeEventListener("error",onError)}
      w.addEventListener("message",onMessage);
      w.addEventListener("error",onError);
      w.postMessage(data);
    });
    let sawReplayPanic=false;
    try{
     const init=await exchange({kind:"oreslang-v2-init",schemaId,descriptor});
     if(init.kind!=="oreslang-v2-ready")throw Error("Worker init refused");
     const frame=await encodeActorMessageV2({schemaId,descriptor,value:["valid",42n]});
     const receipt=await exchange({kind:"oreslang-v2-data",id:9,frame});
     if(receipt.kind!=="oreslang-v2-receipt"||receipt.id!==9)throw Error("valid DATA not received");
     const replay=await exchange({kind:"oreslang-v2-data",id:9,frame});
     if(replay.kind!=="oreslang-v2-panic")throw Error("replayed DATA accepted");
     sawReplayPanic=true;
    }finally{w.terminate()}
    // Load real compiled C runtime, not an LLVM-IR stand-in.
    const wasmBytes=new Uint8Array(await(await fetch("/compiled-runtime.wasm")).arrayBuffer());
    let clockCalls=0;
    const rt=await loadOreslangWasm(wasmBytes,{
     requestedCapabilities:["clock"],grantedCapabilities:["clock"],
     host:{clockMs:()=>{clockCalls++;return 1234}}
    });
    if(rt.instance.exports.ores_rt_abi_version()!==1)throw Error("wrong core ABI");
    if(rt.instance.exports.ores_rt_clock_ms()!==1234||clockCalls!==1)
      throw Error("real Wasm clock capability mismatch");
    return {admitted:admitted.length,drained:a.pending===0,replayRejected:sawReplayPanic,
      wasmABIVersion:rt.instance.exports.ores_rt_abi_version(),clockCalls};
   });
   assert.deepEqual(pageErrors,[],name+": browser page errors");
   assert.deepEqual(result,{admitted:12,drained:true,replayRejected:true,
      wasmABIVersion:1,clockCalls:1},name+": browser engine mismatches");
   console.log("REAL_BROWSER_ENGINE_PASS",name,JSON.stringify(result));
   await page.close();
  }finally{await browser.close()}
 }
}finally{await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()))}
