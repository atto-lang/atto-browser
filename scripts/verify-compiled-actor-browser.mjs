/**
 * Exact-source Oreslang LLVM actor Wasm -> real Chromium/Firefox module Worker.
 * Never substitute a Node Worker shim, C runtime stand-in, or scalar main().
 * This is a browser integration gate, not a complete cross-host actor proof.
 */
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {readFile,stat} from "node:fs/promises";
import {resolve,dirname,extname,isAbsolute} from "node:path";
import {fileURLToPath} from "node:url";
import {chromium,firefox} from "playwright";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const artifact=process.env.ORE_REAL_ACTOR_WASM;
const sidecar=process.env.ORE_REAL_ACTOR_MANIFEST;
assert.ok(isAbsolute(artifact||"")&&isAbsolute(sidecar||""),
 "mandatory compiler-generated actor Wasm and manifest paths");
for(const path of [artifact,sidecar]){
 const info=await stat(path);
 assert.ok(info.isFile()&&info.size>0&&info.size<16*1024*1024,
  "real actor inputs must be bounded regular files");
}
const mime={".mjs":"text/javascript;charset=utf-8",".wasm":"application/wasm",
 ".json":"application/json;charset=utf-8"};
const allow=new Map([
 ["/src/actor-message-worker.mjs",resolve(root,"src/actor-message-worker.mjs")],
 ["/src/actor-transport.mjs",resolve(root,"src/actor-transport.mjs")],
 ["/src/messagepack-v2.mjs",resolve(root,"src/messagepack-v2.mjs")],
 ["/compiled-actor.wasm",artifact],
 ["/compiled-actor.manifest.json",sidecar],
]);
function deny(response,status){
 response.writeHead(status,{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"});
 response.end();
}
const server=createServer(async(request,response)=>{
 try{
  if(request.method!=="GET")return deny(response,405);
  const origin="http://127.0.0.1:"+server.address().port;
  if(request.headers.host!=="127.0.0.1:"+server.address().port)return deny(response,403);
  const url=new URL(request.url,origin);
  if(url.search||url.hash)return deny(response,400);
  if(url.pathname==="/"){
   response.writeHead(200,{"Content-Type":"text/html;charset=utf-8",
    "Cache-Control":"no-store","X-Content-Type-Options":"nosniff"});
   return response.end("<!doctype html><title>Oreslang compiler actor browser gate</title>");
  }
  const path=allow.get(url.pathname);
  if(!path)return deny(response,403);
  const bytes=await readFile(path);
  response.writeHead(200,{"Content-Type":mime[extname(path)]||"application/octet-stream",
   "Cache-Control":"no-store","X-Content-Type-Options":"nosniff"});
  response.end(bytes);
 }catch{return deny(response,404)}
});
await new Promise((done,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",done)});
const origin="http://127.0.0.1:"+server.address().port;
try{
 for(const [engine,browserType] of [["chromium",chromium],["firefox",firefox]]){
  const browser=await browserType.launch({headless:true});
  try{
   const page=await browser.newPage();
   page.setDefaultTimeout(25000);
   const exceptions=[];
   page.on("pageerror",error=>exceptions.push(String(error)));
   await page.goto(origin+"/");
   const result=await page.evaluate(async()=>{
    const {createActorMessageTransport}=await import("/src/actor-transport.mjs");
    const {encodeActorMessageV2}=await import("/src/messagepack-v2.mjs");
    const artifact=await(await fetch("/compiled-actor.wasm")).arrayBuffer();
    const manifest=await(await fetch("/compiled-actor.manifest.json")).json();
    const incarnation="a".repeat(32);
    const contract={schemaId:"example.Counter#variant=1",descriptor:"I"};
    function worker(){return new Worker("/src/actor-message-worker.mjs",{type:"module"})}
    function exchange(w,payload){
     return new Promise((done,reject)=>{
      const timer=setTimeout(()=>{clean();reject(Error("real browser actor Worker timeout"))},12000);
      const onMessage=event=>{clean();done(event.data)};
      const onError=()=>{clean();reject(Error("browser Worker execution error"))};
      function clean(){clearTimeout(timer);w.removeEventListener("message",onMessage);
       w.removeEventListener("error",onError)}
      w.addEventListener("message",onMessage);w.addEventListener("error",onError);
      w.postMessage(payload);
     });
    }
    const frame=value=>encodeActorMessageV2({...contract,value});
    const first=worker();
    try{
     const ready=await exchange(first,{kind:"oreslang-v2-init",...contract,incarnation,
      guest:{wasmBytes:artifact,manifest}});
     if(ready.kind!=="oreslang-v2-ready"||ready.incarnation!==incarnation)
      throw Error("real browser compiled actor INIT rejected");
     for(const [id,value,expected] of [[1,2n,12n],[2,3n,15n],[4,1n,16n]]){
      const received=await exchange(first,{kind:"oreslang-v2-data",incarnation,
       id,frame:await frame(value)});
      if(received.kind!=="oreslang-v2-receipt"||received.result!==expected||
        received.incarnation!==incarnation||received.id!==id)
       throw Error("compiled actor stateful reply or FIFO ticket mismatch");
     }
     const stop=await exchange(first,{kind:"oreslang-v2-control",action:"drain",incarnation});
     if(stop.kind!=="oreslang-v2-stopped"||stop.incarnation!==incarnation)
      throw Error("compiled actor CONTROL drain rejected");
    }finally{first.terminate()}
    const stale=worker();
    try{
     const ready=await exchange(stale,{kind:"oreslang-v2-init",...contract,
      incarnation,guest:{wasmBytes:artifact,manifest}});
     if(ready.kind!=="oreslang-v2-ready")throw Error("restarted actor INIT rejected");
     const fresh=await exchange(stale,{kind:"oreslang-v2-data",incarnation,
      id:1,frame:await frame(1n)});
     if(fresh.result!==11n)throw Error("browser Worker shared actor state across instances");
     const rejected=await exchange(stale,{kind:"oreslang-v2-data",
      incarnation:"b".repeat(32),id:2,frame:await frame(10n)});
     if(rejected.kind!=="oreslang-v2-panic"||rejected.incarnation!==incarnation)
      throw Error("stale incarnation DATA accepted");
    }finally{stale.terminate()}

    const a=createActorMessageTransport({...contract,
     guest:{wasmBytes:artifact,manifest},actorKey:"browser/restart-fence",timeoutMs:10000});
    await a.send(2n);
    let secondBlocked=false;
    try{createActorMessageTransport({...contract,guest:{wasmBytes:artifact,manifest},
      actorKey:"browser/restart-fence",timeoutMs:10000})}
    catch(e){secondBlocked=/incarnation still active/.test(String(e))}
    if(!secondBlocked)throw Error("duplicate actor identity was admitted");
    await a.drain();
    const replacement=createActorMessageTransport({...contract,
      guest:{wasmBytes:artifact,manifest},actorKey:"browser/restart-fence",timeoutMs:10000});
    if(await replacement.send(1n)!==true)throw Error("replacement actor DATA rejected");
    await replacement.drain();
    return {sourceActor:true,replies:[12,15,16],newIncarnationState:11,
      staleRejected:true,duplicateIdentityBlocked:true,cleanRestart:true};
   });
   assert.deepEqual(exceptions,[],engine+": unexpected browser page errors");
   assert.deepEqual(result,{sourceActor:true,replies:[12,15,16],
    newIncarnationState:11,staleRejected:true,duplicateIdentityBlocked:true,
    cleanRestart:true},engine+": actor browser execution mismatch");
   console.log("REAL_COMPILED_ORESLANG_ACTOR_BROWSER_PASS",engine,JSON.stringify(result));
   await page.close();
  }finally{await browser.close()}
 }
}finally{
 await new Promise((done,reject)=>server.close(error=>error?reject(error):done()));
}
