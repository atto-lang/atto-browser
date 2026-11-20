import test from "node:test";
import assert from "node:assert/strict";
import {inspectWasmBytes} from "../src/inspect.mjs";

test("browser Wasm inspector copies native bytes instead of guest iterators",()=>{
 const view=Uint8Array.from([0,97,115,109,1,0,0,0]);
 let calls=0;
 Object.defineProperty(view,Symbol.iterator,{value:function*(){
  calls++;throw Error("guest-controlled iterator must not execute");
 }});
 const result=inspectWasmBytes(view,{maxModuleBytes:64});
 assert.equal(result.bytes.length,8);
 assert.equal(result.memoryCount,0);
 assert.equal(result.bytes[3],109);
 assert.equal(calls,0);
});

test("inspector result owns an independent copy of the admitted Wasm header",()=>{
 const view=Uint8Array.from([0,97,115,109,1,0,0,0]);
 const result=inspectWasmBytes(view,{maxModuleBytes:64});
 view[1]=0;
 assert.equal(result.bytes[1],97);
});
