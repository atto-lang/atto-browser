/**
 * Real Chromium/Firefox integration gate. Requires an explicitly installed,
 * pinned Playwright package plus browser binaries; never silently skips.
 * Executes the actual module Worker and host across the browser boundary.
 * The handler remains reference JavaScript, not compiled Oreslang Wasm.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {chromium,firefox} from "playwright";

const root=new URL("../",import.meta.url);
const serve=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,"http://localhost");
  if(url.pathname==="/"){
   res.writeHead(200,{"content-type":"text/html; charset=utf-8",
     "cache-control":"no-store","cross-origin-resource-policy":"same-origin"});
   res.end("<!doctype html><meta charset=utf-8><title>Oreslang Worker E2E</title>");
   return;
  }
  if(!/^\/src\/[a-zA-Z0-9/_-]+\.mjs$/.test(url.pathname)||
     url.pathname.split("/").includes(".."))throw Error("invalid path");
  const data=await readFile(fileURLToPath(new URL("."+url.pathname,root)));
  res.writeHead(200,{"content-type":"text/javascript; charset=utf-8",
    "cache-control":"no-store","cross-origin-resource-policy":"same-origin"});
  res.end(data);
 }catch{
  res.writeHead(404,{"content-type":"text/plain"});res.end("not found");
 }
});
await new Promise((resolve,reject)=>{
 serve.once("error",reject);
 serve.listen(0,"127.0.0.1",resolve);
});
const origin="http://127.0.0.1:"+serve.address().port;
try{
 for(const [label,engine] of [["Chromium",chromium],["Firefox",firefox]]){
  await test("real "+label+" Worker: 12 typed round trips, snapshot, and shutdown",{
    timeout:120000
  },async()=>{
   const browser=await engine.launch({headless:true});
   try{
    const page=await browser.newPage();
    const errors=[];
    page.on("pageerror",e=>errors.push(String(e)));
    await page.goto(origin,{waitUntil:"load"});
    // Node's test timeout does not interrupt a pending Playwright page.evaluate().
    // A separate host deadline must reject even if guest Worker/browser JS hangs.
    let evaluationWatchdog;
    const outcome=await Promise.race([
      page.evaluate(async()=>{
      const {createOwnedActorWorker}=await import("/src/owned-actor-host.mjs");
      const schema={schemaVersion:1,ownership:"copy",variants:[
       {id:1,name:"Compute",fields:[{name:"text",type:"string"},{name:"n",type:"i64"}]},
       {id:2,name:"Result",fields:[{name:"text",type:"string"},{name:"n",type:"i64"}]}
      ]};
      const compute=(text,n)=>({variant:"Compute",fields:{text,n:BigInt(n)}});
      const actor=await createOwnedActorWorker({schema,maxPending:24,timeoutMs:10000});
      let roundTrips=0,badVariantRejected=false,mutatedSnapshot=false;
      try{
       const results=await Promise.all(Array.from({length:12},(_,i)=>actor.request(compute("browser-"+i,i))));
       for(let i=0;i<results.length;i++){
        if(results[i].variant!=="Result"||
           results[i].fields.text!=="browser-"+i||
           results[i].fields.n!==BigInt(i+1))throw Error("typed reply mismatch at "+i);
        roundTrips++;
       }
       const mutable=compute("snapshot-before",41);
       const reserved=actor.request(mutable);
       mutable.fields.text="snapshot-after";mutable.fields.n=99n;
       const response=await reserved;
       mutatedSnapshot=response.fields.text==="snapshot-before"&&response.fields.n===42n;
       try{await actor.request({variant:"Result",fields:{text:"invalid",n:1n}})}
       catch(e){badVariantRejected=/unadmitted/.test(String(e))}
       if(actor.pending!==0)throw Error("Worker leaked pending reservations");
      }finally{actor.close()}
      const closeActor=await createOwnedActorWorker({schema,maxPending:4,timeoutMs:10000});
      const pending=closeActor.request(compute("will-close",2));
      closeActor.close();
      let closeRejected=false;
      try{await pending}catch(e){closeRejected=/actor closed/.test(String(e))}
      return {roundTrips,badVariantRejected,mutatedSnapshot,closeRejected,pendingAfterClose:closeActor.pending};
      }),
      new Promise((_,reject)=>{
        evaluationWatchdog=setTimeout(()=>reject(new Error("browser Worker evaluation exceeded independent 90-second host deadline")),90000);
      })
    ]).finally(()=>clearTimeout(evaluationWatchdog));
    assert.deepEqual(outcome,{roundTrips:12,badVariantRejected:true,mutatedSnapshot:true,closeRejected:true,pendingAfterClose:0});
    assert.deepEqual(errors,[],"uncaught page errors: "+errors.join("; "));
   }finally{await browser.close()}
  });
 }
}finally{await new Promise(resolve=>serve.close(resolve))}
