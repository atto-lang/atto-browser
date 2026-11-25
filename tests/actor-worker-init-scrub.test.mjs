import test from "node:test";
import assert from "node:assert/strict";

async function withWorkerEndpoint(tag,exercise){
 const original=Object.getOwnPropertyDescriptor(globalThis,"self");
 let handler;
 const sent=[];
 try{
  Object.defineProperty(globalThis,"self",{configurable:true,value:{
   addEventListener(kind,callback){if(kind==="message")handler=callback},
   postMessage(value){sent.push(value)}
  }});
  await import("../src/actor-message-worker.mjs?test-init-scrub="+tag);
  assert.equal(typeof handler,"function");
  await exercise(handler,sent);
 }finally{
  if(original)Object.defineProperty(globalThis,"self",original);
  else delete globalThis.self;
 }
}

test("malformed INIT erases received guest artifact without publishing READY",async()=>{
 await withWorkerEndpoint("malformed",async(handler,sent)=>{
  const wasmBytes=Uint8Array.from([0,97,115,109,1,0,0,0]);
  await handler({data:{kind:"oreslang-v2-init",schemaId:42,
   descriptor:"I",guest:{wasmBytes}}});
  assert.ok(wasmBytes.every(byte=>byte===0));
  assert.deepEqual(sent,[{kind:"oreslang-v2-panic"}]);
  const another=Uint8Array.from([1,2,3]);
  await handler({data:{kind:"oreslang-v2-init",schemaId:"later",descriptor:"I",
   guest:{wasmBytes:another}}});
  assert.ok(another.every(byte=>byte===0));
  assert.deepEqual(sent,[{kind:"oreslang-v2-panic"}]);
 });
});

test("clean drain revokes mailbox and wipes any late received DATA bytes",async()=>{
 await withWorkerEndpoint("drained",async(handler,sent)=>{
  const schemaId="example.Counter#variant=1",descriptor="I";
  await handler({data:{kind:"oreslang-v2-init",schemaId,descriptor}});
  await handler({data:{kind:"oreslang-v2-control",action:"drain"}});
  assert.deepEqual(sent,[{kind:"oreslang-v2-ready"},{kind:"oreslang-v2-stopped"}]);
  const staleFrame=new DataView(Uint8Array.from([1,2,3,4,5]).buffer);
  await handler({data:{kind:"oreslang-v2-data",id:1,frame:staleFrame}});
  assert.ok(new Uint8Array(staleFrame.buffer).every(byte=>byte===0));
  assert.equal(sent.length,2,"late DATA must not receive a receipt or new panic");
 });
});
