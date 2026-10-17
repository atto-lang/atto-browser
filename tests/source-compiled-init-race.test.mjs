import test from "node:test";
import assert from "node:assert/strict";
import {createHash,webcrypto} from "node:crypto";
import {encodeActorMessageV2} from "../src/messagepack-v2.mjs";

// Self-contained source-compiled Wasm fixture: import-free, memory min/max 2,
// functions init(), on_message(i64)->i64 (identity), teardown(). This is a
// minimal ABI fixture; native source compilation is checked separately in CI.
const leb=x=>{const v=[];do{let b=x&127;x>>>=7;if(x)b|=128;v.push(b)}while(x);return v};
const name=x=>{const b=[...new TextEncoder().encode(x)];return [...leb(b.length),...b]};
const section=(id,body)=>[id,...leb(body.length),...body];
const entry=(nameValue,index)=>[...name(nameValue),0,...leb(index)];
const wasm=Uint8Array.from([
 0,97,115,109,1,0,0,0,
 ...section(1,[2,0x60,0,0,0x60,1,0x7e,1,0x7e]),
 ...section(3,[3,0,1,0]),
 ...section(5,[1,1,2,2]),
 ...section(7,[3,...entry("oreslang_wasm_actor_init",0),
                  ...entry("oreslang_wasm_actor_on_message",1),
                  ...entry("oreslang_wasm_actor_teardown",2)]),
 ...section(10,[3,2,0,0x0b,4,0,0x20,0,0x0b,2,0,0x0b])
]);
assert.ok(WebAssembly.validate(wasm),"minimal compiler-actor ABI fixture must be valid");
const sha=createHash("sha256").update(wasm).digest("hex");
const schemaId="example.Counter#variant=1",descriptor="I";

async function endpoint(label,block,opts={}){
 const selfBefore=Object.getOwnPropertyDescriptor(globalThis,"self");
 const wasmBefore=Object.getOwnPropertyDescriptor(globalThis,"WebAssembly");
 const cryptoBefore=Object.getOwnPropertyDescriptor(globalThis,"crypto");
 const realWasm=globalThis.WebAssembly;
 const received=[];
 let dispatch;
 const spy={init:0,teardown:0,compile:0};
 try{
  Object.defineProperty(globalThis,"self",{configurable:true,value:{
   addEventListener(kind,callback){if(kind==="message")dispatch=callback},
   postMessage(message){received.push(message)}
  }});
  const patched=Object.create(realWasm);
  patched.Instance=function(module){
   const real=new realWasm.Instance(module);
   return {exports:{...real.exports,
    oreslang_wasm_actor_init(...args){
     spy.init++;
     if(opts.initTrap)throw Error("synthetic init trap");
     return real.exports.oreslang_wasm_actor_init(...args)
    },
    oreslang_wasm_actor_teardown(...args){
     spy.teardown++;
     return real.exports.oreslang_wasm_actor_teardown(...args)
    }}};
  };
  patched.compile=(...args)=>{
   spy.compile++;
   return opts.compile?opts.compile(realWasm.compile.bind(realWasm),...args):
    realWasm.compile(...args);
  };
  Object.defineProperty(globalThis,"WebAssembly",{configurable:true,value:patched});
  Object.defineProperty(globalThis,"crypto",{configurable:true,value:{subtle:{
   digest:(...args)=>opts.digest?opts.digest(...args):webcrypto.subtle.digest(...args)
  }}});
  await import("../src/source-compiled-actor-worker.mjs?init-fence="+label);
  assert.equal(typeof dispatch,"function");
  const init=()=>dispatch({data:{kind:"oreslang-v2-source-init",schemaId,descriptor,
   wasmSha256:sha,wasm:Uint8Array.from(wasm)}});
  await block({dispatch,init,received,spy});
 }finally{
  for(const [key,old] of [["self",selfBefore],["WebAssembly",wasmBefore],["crypto",cryptoBefore]]){
   if(old)Object.defineProperty(globalThis,key,old);else delete globalThis[key];
  }
 }
}

test("source-compiled actor executes real import-free guest ABI and drains",async()=>{
 await endpoint("positive",async({dispatch,init,received,spy})=>{
  await init();
  assert.deepEqual(received,[{kind:"oreslang-v2-ready"}]);
  const frame=await encodeActorMessageV2({schemaId,descriptor,value:17n});
  await dispatch({data:{kind:"oreslang-v2-data",id:1,frame}});
  assert.deepEqual(received.at(-1),{kind:"oreslang-v2-receipt",id:1,ok:true,result:17n});
  await dispatch({data:{kind:"oreslang-v2-control",action:"drain"}});
  assert.deepEqual(received.at(-1),{kind:"oreslang-v2-stopped"});
  assert.equal(spy.init,1);
 });
});

test("terminal panic during SHA-256 forbids late Wasm compile or guest init",async()=>{
 let digestEntered,release;
 const entered=new Promise(resolve=>{digestEntered=resolve});
 await endpoint("digest",async({dispatch,init,received,spy})=>{
  const pending=init();
  await entered;
  const frame=Uint8Array.of(1,2,3);
  await dispatch({data:{kind:"oreslang-v2-data",id:1,frame}});
  assert.deepEqual(received,[{kind:"oreslang-v2-panic"}]);
  release();
  await pending;
  assert.equal(spy.init,0,"terminal actor unexpectedly executed init()");
  assert.equal(spy.compile,0,"terminal actor unexpectedly started Wasm compilation");
  assert.deepEqual(received,[{kind:"oreslang-v2-panic"}]);
  assert.ok(frame.every(x=>x===0));
 },{digest:(algorithm,bytes)=>new Promise((resolve,reject)=>{
  release=()=>webcrypto.subtle.digest(algorithm,bytes).then(resolve,reject);
  digestEntered();
 })});
});

test("terminal panic during asynchronous Wasm compilation forbids guest init",async()=>{
 let compileEntered,release;
 const entered=new Promise(resolve=>{compileEntered=resolve});
 await endpoint("compile",async({dispatch,init,received,spy})=>{
  const pending=init();
  await entered;
  await dispatch({data:{kind:"oreslang-v2-data",id:1,frame:Uint8Array.of(1)}});
  assert.deepEqual(received,[{kind:"oreslang-v2-panic"}]);
  release();
  await pending;
  assert.equal(spy.init,0,"guest init executed after terminal panic");
  assert.deepEqual(received,[{kind:"oreslang-v2-panic"}]);
 },{compile:(realCompile,bytes)=>new Promise((resolve,reject)=>{
  release=()=>realCompile(bytes).then(resolve,reject);
  compileEntered();
 })});
});

test("guest init trap tears down partial actor exactly once",async()=>{
 await endpoint("init-trap",async({init,received,spy})=>{
  await init();
  assert.deepEqual(received,[{kind:"oreslang-v2-panic"}]);
  assert.equal(spy.init,1);
  assert.equal(spy.teardown,1,"partial guest must be retired exactly once");
 },{initTrap:true});
});

