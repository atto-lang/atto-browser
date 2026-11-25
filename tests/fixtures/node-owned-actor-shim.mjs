import {parentPort} from "node:worker_threads";
const queued=[];
let onMessage;
parentPort.on("message",data=>{
 if(onMessage)onMessage({data});else queued.push(data);
});
globalThis.self={
 addEventListener(kind,cb){
  if(kind!=="message")return;
  onMessage=cb;
  for(const data of queued.splice(0))cb({data});
 },
 postMessage(value){parentPort.postMessage(value)}
};
await import("../../src/owned-actor-worker.mjs");
