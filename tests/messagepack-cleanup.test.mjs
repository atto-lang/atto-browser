import test from "node:test";
import assert from "node:assert/strict";
import {encodeActorMessageV2,decodeActorMessageV2} from "../src/messagepack-v2.mjs";

const contract={schemaId:"example.Compute#variant=1",descriptor:"T[S,I]"};

test("successful and malformed decode scrub private byte snapshots but preserve caller input",async()=>{
 const frame=await encodeActorMessageV2({...contract,value:["private message",42n]});
 const pristine=Uint8Array.from(frame);
 const malformed=Uint8Array.from(frame);malformed[1]=1;
 const original=Uint8Array.prototype.fill;
 const captured=[];
 Uint8Array.prototype.fill=function(...args){
  captured.push(this);
  return Reflect.apply(original,this,args);
 };
 try{
  assert.deepEqual(await decodeActorMessageV2({...contract,bytes:frame}),["private message",42n]);
  await assert.rejects(decodeActorMessageV2({...contract,bytes:malformed}),/version\/envelope mismatch/);
  assert.equal(captured.length,2,"each decode allocates one owned snapshot");
  for(const copy of captured)assert.ok(copy.every(byte=>byte===0),"owned decode snapshot was not wiped");
  assert.deepEqual(frame,pristine,"caller-owned DATA input is unchanged");
 }finally{Uint8Array.prototype.fill=original}
});

test("encoder scrubs all intermediate typed buffers without corrupting returned frame",async()=>{
 const fill=Uint8Array.prototype.fill;
 const cleared=[];
 Uint8Array.prototype.fill=function(...args){
  cleared.push(this);
  return Reflect.apply(fill,this,args);
 };
 let frame;
 try{frame=await encodeActorMessageV2({...contract,value:["secret payload",99n]})}
 finally{Uint8Array.prototype.fill=fill}
 assert.ok(frame.some(b=>b!==0),"returned frame must remain usable");
 assert.ok(cleared.length>=3,"encoder intermediate buffers must be cleared");
 for(const bytes of cleared)assert.ok(bytes.every(b=>b===0),"encoder retained uncleared intermediate");
 assert.deepEqual(await decodeActorMessageV2({...contract,bytes:frame}),["secret payload",99n]);
});


test("codec admission ignores view getter shadowing and rejects shared backing",async()=>{
 const frame=await encodeActorMessageV2({...contract,value:["private",42n]});
 let getterCalls=0;
 Object.defineProperty(frame,"buffer",{get(){getterCalls++;throw Error("untrusted backing getter");}});
 Object.defineProperty(frame,"byteLength",{get(){getterCalls++;throw Error("untrusted length getter");}});
 assert.deepEqual(await decodeActorMessageV2({...contract,bytes:frame}),["private",42n]);
 assert.equal(getterCalls,0);
 if(typeof SharedArrayBuffer==="function"){
  const view=new Uint8Array(new SharedArrayBuffer(64));
  Object.defineProperty(view,"buffer",{get(){getterCalls++;return new ArrayBuffer(64)}});
  await assert.rejects(decodeActorMessageV2({...contract,bytes:view}),/shared memory is forbidden/);
  assert.equal(getterCalls,0);
 }
 const over=new Uint8Array(129);
 Object.defineProperty(over,"byteLength",{value:1});
 await assert.rejects(decodeActorMessageV2({...contract,bytes:over,maxBytes:128}),/frame byte budget/);
});
