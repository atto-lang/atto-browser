/**
 * Real .ores -> oreslang-llvmc --target=wasm32 -> Clang -> browser Worker.
 * Requires a compiled artifact supplied externally; no IR fixture/mock.
 * Fails rather than skipping when the artifact is missing.
 */
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {createServer} from "node:http";
import {readFile} from "node:fs/promises";
import {resolve,dirname,extname} from "node:path";
import {fileURLToPath} from "node:url";
import {chromium,firefox} from "playwright";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const guestPath=process.env.ORESLANG_SOURCE_ACTOR_WASM_BINARY;
assert.ok(guestPath,"source-compiled Oreslang guest path required; never use a fixture stand-in");
const wasm=await readFile(resolve(root,guestPath));
assert.ok(wasm.byteLength>0&&wasm.byteLength<=1048576,"guest artifact size");
const sha256=createHash("sha256").update(wasm).digest("hex");
const resources=new Map([
 ["/compiled-actor.wasm",resolve(root,guestPath)],
 ["/src/source-compiled-actor-worker.mjs",resolve(root,"src/source-compiled-actor-worker.mjs")],
 ["/src/messagepack-v2.mjs",resolve(root,"src/messagepack-v2.mjs")],
 ["/src/inspect.mjs",resolve(root,"src/inspect.mjs")]
]);
const server=createServer(async(request,response)=>{
 const deny=(code,msg)=>{response.writeHead(code,{"Content-Type":"text/plain"});response.end(msg)};
 if(request.method!=="GET"||request.headers.host!=="127.0.0.1:"+server.address().port)
  return deny(403,"denied");
 const url=new URL(request.url,"http://127.0.0.1");
 if(url.search||url.pathname.includes("%")||url.pathname.includes(".."))
  return deny(403,"invalid path");
 if(url.pathname==="/"){
  response.writeHead(200,{"Content-Type":"text/html;charset=utf-8"});
  response.end("<!doctype html><title>Actual Oreslang actor browser test</title>");return;
 }
 const file=resources.get(url.pathname);
 if(!file)return deny(403,"unlisted resource");
 try{
  const bytes=await readFile(file);
  response.writeHead(200,{"Content-Type":extname(file)===".wasm"?"application/wasm":"text/javascript",
   "Cache-Control":"no-store","X-Content-Type-Options":"nosniff"});response.end(bytes);
 }catch{return deny(404,"not found")}
});
await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve)});
try{
 const origin="http://127.0.0.1:"+server.address().port;
 for(const [name,type] of [["chromium",chromium],["firefox",firefox]]){
  const browser=await type.launch({headless:true});
  try{
   const page=await browser.newPage();page.setDefaultTimeout(25000);
   await page.goto(origin+"/");
   const result=await page.evaluate(async({sha256})=>{
    const {encodeActorMessageV2}=await import("/src/messagepack-v2.mjs");
    const bytes=new Uint8Array(await(await fetch("/compiled-actor.wasm")).arrayBuffer());
    const schemaId="actor.Counter#variant=1",descriptor="I";
    const workerUrl="/src/source-compiled-actor-worker.mjs";
    const exchange=(w,data)=>new Promise((resolve,reject)=>{
     let timer;
     const clean=()=>{clearTimeout(timer);w.removeEventListener("message",received);
       w.removeEventListener("error",onError)}
     const received=e=>{clean();resolve(e.data)};
     const onError=e=>{clean();reject(Error("real guest Worker error: "+String(e.message)))};
     timer=setTimeout(()=>{clean();reject(Error("guest Worker protocol deadline"))},12000);
     w.addEventListener("message",received);
     w.addEventListener("error",onError);
     w.postMessage(data);
    });
    let panics=0;
    const worker=new Worker(workerUrl,{type:"module"});
    try{
     worker.addEventListener("message",e=>{if(e.data?.kind==="oreslang-v2-panic")panics++});
     const ready=await exchange(worker,{kind:"oreslang-v2-source-init",
      schemaId,descriptor,wasm:bytes,wasmSha256:sha256});
     if(ready.kind!=="oreslang-v2-ready")throw Error("compiled source guest not admitted");
     for(let id=1;id<=100;id++){
      const frame=await encodeActorMessageV2({schemaId,descriptor,value:1n});
      const receipt=await exchange(worker,{kind:"oreslang-v2-data",id,frame});
      if(receipt.kind!=="oreslang-v2-receipt"||receipt.id!==id||
       receipt.ok!==true||receipt.result!==BigInt(id))
       throw Error("compiled source actor state/result mismatch at "+id);
     }
     const stopped=await exchange(worker,{kind:"oreslang-v2-control",action:"drain"});
     if(stopped.kind!=="oreslang-v2-stopped")throw Error("guest teardown absent");
     if(panics!==0)throw Error("unexpected source guest panic");
    }finally{worker.terminate()}
    // Digest corruption must reject before actor init, not execute guest.
    const bad=new Worker(workerUrl,{type:"module"});
    try{
     const result=await exchange(bad,{kind:"oreslang-v2-source-init",
      schemaId,descriptor,wasm:bytes,wasmSha256:"0".repeat(64)});
     if(result.kind!=="oreslang-v2-panic")throw Error("bad artifact digest admitted");
    }finally{bad.terminate()}
    return {messages:100,lastResult:100,panics,hashRefusal:true};
   },{sha256});
   assert.deepEqual(result,{messages:100,lastResult:100,panics:0,hashRefusal:true});
   console.log("REAL_SOURCE_COMPILED_ORESLANG_BROWSER_ACTOR_PASS",name,JSON.stringify(result));
   await page.close();
  }finally{await browser.close()}
 }
}finally{await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()))}
