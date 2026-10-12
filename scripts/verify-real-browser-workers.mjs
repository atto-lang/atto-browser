/**
 * Real-engine browser transport regression.
 * CI installs pinned Playwright and Chromium/Firefox explicitly; this script
 * is separate from Node-shim unit tests and must never be silently skipped.
 * The tested Workers contain transport code only, not compiled actor handlers.
 */
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {readFile} from "node:fs/promises";
import {resolve,dirname,extname} from "node:path";
import {fileURLToPath} from "node:url";
import {chromium,firefox} from "playwright";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const runtime=process.env.ORESLANG_WASM_RUNTIME_BINARY
 ? resolve(root,process.env.ORESLANG_WASM_RUNTIME_BINARY):null;
assert.ok(runtime,"ORESLANG_WASM_RUNTIME_BINARY is required (real compiled C ABI Wasm)");
// Only the module dependency closure and the separately compiled C runtime
// are public. A path-prefix check also follows symlinks inside the checkout;
// this explicit map cannot accidentally expose credentials or test fixtures.
const allowed=new Map([
 ["/src/actor-transport.mjs",resolve(root,"src/actor-transport.mjs")],
 ["/src/actor-message-worker.mjs",resolve(root,"src/actor-message-worker.mjs")],
 ["/src/actor-contract.mjs",resolve(root,"src/actor-contract.mjs")],
 ["/src/messagepack-v2.mjs",resolve(root,"src/messagepack-v2.mjs")],
 ["/src/loader.mjs",resolve(root,"src/loader.mjs")],
 ["/src/inspect.mjs",resolve(root,"src/inspect.mjs")],
 ["/compiled-runtime.wasm",runtime]
]);
const media={".mjs":"text/javascript;charset=utf-8",".wasm":"application/wasm"};
function serve(response,code,body){
 response.writeHead(code,{"Content-Type":"text/plain;charset=utf-8",
  "Cache-Control":"no-store","X-Content-Type-Options":"nosniff"});response.end(body)
}
const server=createServer(async(request,response)=>{
 try{
  if(request.method!=="GET")return serve(response,405,"method not allowed");
  if(request.headers.host!=="127.0.0.1:"+server.address().port)
   return serve(response,403,"invalid host");
  const url=new URL(request.url,"http://127.0.0.1");
  if(url.search||url.hash)return serve(response,400,"unexpected query");
  if(url.pathname==="/"){
   response.writeHead(200,{"Content-Type":"text/html;charset=utf-8",
    "Cache-Control":"no-store","X-Content-Type-Options":"nosniff"});
   response.end("<!doctype html><title>Oreslang Worker conformance</title>");return;
  }
  const file=allowed.get(url.pathname);
  if(!file)return serve(response,403,"unlisted test resource");
  const bytes=await readFile(file);
  response.writeHead(200,{"Content-Type":media[extname(file)]||"application/octet-stream",
   "Cache-Control":"no-store","X-Content-Type-Options":"nosniff"});
  response.end(bytes);
 }catch(error){serve(response,404,"not found: "+(error?.code||"invalid request"))}
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
    // A failed admission must release its reserved quota without poisoning
    // the real Worker or reordering a later successful DATA receipt.
    let budgetRefused=false;
    try{await a.send(["🌐".repeat(2000),13n])}
    catch(error){budgetRefused=/frame byte budget/.test(String(error))}
    if(!budgetRefused)throw Error("oversized DATA did not fail admission");
    if(await a.send(["after-rejection",14n])!==true)
      throw Error("valid DATA after rejected admission not accepted");
    await a.drain();
    if(admitted.length!==12||!admitted.every(Boolean)||a.pending!==0||!a.sealed)
      throw Error("real Worker FIFO admission/drain mismatch");

    // A real just-created Worker may be cancelled before READY is delivered.
    // Its in-flight DATA admission and completion must both reject without
    // reporting a supervisor panic for intentional cancellation.
    let cancellationPanics=0;
    const cancelled=createActorMessageTransport({schemaId,descriptor,timeoutMs:2000,
      onSupervisorPanic:()=>cancellationPanics++});
    const inFlight=cancelled.send(["cancel-before-ready",17n]);
    const cancellation=cancelled.stop();
    const settled=await Promise.allSettled([inFlight,cancellation]);
    if(settled.some(r=>r.status!=="rejected")||cancellationPanics!==0||cancelled.pending!==0)
      throw Error("real Worker cancellation failed to drain reservations");

    // An actual module Worker which never answers INIT must be terminated
    // by the host deadline and report exactly one terminal supervisor event.
    const stallUrl=URL.createObjectURL(new Blob(["self.onmessage=()=>{};"],
      {type:"text/javascript"}));
    let deadlinePanics=0,deadlineRejected=false;
    try{
      const stuck=createActorMessageTransport({schemaId,descriptor,timeoutMs:350,
        workerFactory:()=>new Worker(stallUrl,{type:"module"}),
        onSupervisorPanic:()=>deadlinePanics++});
      try{await stuck.get_done()}
      catch(error){deadlineRejected=/deadline exceeded/.test(String(error))}
      if(!deadlineRejected||deadlinePanics!==1||stuck.pending!==0||!stuck.sealed)
       throw Error("unresponsive Worker failed to trigger one terminal CONTROL failure");
    }finally{URL.revokeObjectURL(stallUrl)}

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
      budgetRefused,cancelledCleanly:cancellationPanics===0,deadlinePanics,
      wasmABIVersion:rt.instance.exports.ores_rt_abi_version(),clockCalls};
   });
   assert.deepEqual(pageErrors,[],name+": browser page errors");
   assert.deepEqual(result,{admitted:12,drained:true,replayRejected:true,
      budgetRefused:true,cancelledCleanly:true,deadlinePanics:1,
      wasmABIVersion:1,clockCalls:1},name+": browser engine mismatches");
   console.log("REAL_BROWSER_ENGINE_PASS",name,JSON.stringify(result));
   await page.close();
  }finally{await browser.close()}
 }
}finally{await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()))}
