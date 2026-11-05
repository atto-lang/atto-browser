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
 const spy={init:0,compile:0,teardown:0,messages:0};
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
     spy.init++;return real.exports.oreslang_wasm_actor_init(...args)
    },
    oreslang_wasm_actor_on_message(...args){
     spy.messages++;return real.exports.oreslang_wasm_actor_on_message(...args)
    },
    oreslang_wasm_actor_teardown(...args){
     spy.teardown++;
     if(opts.trapTeardown)throw Error("simulated guest teardown trap");
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
  assert.equal(spy.messages,1,"one source DATA invokes the guest once");
  assert.equal(spy.teardown,1,"successful drain destroys guest once");
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

test("guest teardown trap during CONTROL drain reports panic without retry",async()=>{
 await endpoint("teardown-trap-drain",async({dispatch,init,received,spy})=>{
  await init();
  assert.deepEqual(received,[{kind:"oreslang-v2-ready"}]);
  await dispatch({data:{kind:"oreslang-v2-control",action:"drain"}});
  assert.deepEqual(received,[{kind:"oreslang-v2-ready"},{kind:"oreslang-v2-panic"}],
   "drain teardown trap must report one terminal supervisor panic");
  assert.equal(spy.teardown,1,
   "a throwing teardown must never be invoked again by panic()");
  await dispatch({data:{kind:"oreslang-v2-control",action:"drain"}});
  assert.equal(spy.teardown,1,"post-panic CONTROL never repeats teardown");
  assert.equal(received.length,2,"no additional terminal or stopped receipt");
 },{trapTeardown:true});
});

test("malformed DATA terminal panic performs exactly one trapping teardown",async()=>{
 await endpoint("teardown-trap-panic",async({dispatch,init,received,spy})=>{
  await init();
  const bad=Uint8Array.of(1,2,3);
  await dispatch({data:{kind:"oreslang-v2-data",id:1,frame:bad}});
  assert.deepEqual(received,[{kind:"oreslang-v2-ready"},{kind:"oreslang-v2-panic"}]);
  assert.equal(spy.teardown,1,"terminal panic tears down at most once");
  assert.ok(bad.every(x=>x===0),"bad DATA frame is scrubbed");
  await dispatch({data:{kind:"oreslang-v2-data",id:2,frame:Uint8Array.of(9)}});
  assert.equal(spy.teardown,1);
 },{trapTeardown:true});
});

test("terminal panic while DATA SHA is suspended forbids later guest execution",async()=>{
 const sourceFrame=await encodeActorMessageV2({schemaId,descriptor,value:11n});
 let calls=0,entered,release;
 const suspended=new Promise(resolve=>entered=resolve);
 await endpoint("data-sha-panic",async({dispatch,init,received,spy})=>{
  await init();
  const original=Uint8Array.from(sourceFrame);
  const pending=dispatch({data:{kind:"oreslang-v2-data",id:1,frame:original}});
  await suspended;
  // A concurrent DATA ticket is an actor protocol violation, and must
  // terminally panic before either suspended message invokes guest code.
  const conflicting=Uint8Array.from(sourceFrame);
  await dispatch({data:{kind:"oreslang-v2-data",id:2,frame:conflicting}});
  assert.deepEqual(received,[{kind:"oreslang-v2-ready"},{kind:"oreslang-v2-panic"}]);
  assert.equal(spy.messages,0);
  assert.equal(spy.teardown,1,"panic releases guest exactly once");
  assert.ok(conflicting.every(byte=>byte===0),"conflicting DATA clone scrubbed");
  release();
  await pending;
  assert.equal(spy.messages,0,"late decoded message must not reach guest");
  assert.ok(original.every(byte=>byte===0),"cancelled DATA clone scrubbed");
  assert.deepEqual(received,[{kind:"oreslang-v2-ready"},{kind:"oreslang-v2-panic"}]);
 },{digest:(algorithm,bytes)=>{
  if(++calls===1)return webcrypto.subtle.digest(algorithm,bytes);
  return new Promise((resolve,reject)=>{
   release=()=>webcrypto.subtle.digest(algorithm,bytes).then(resolve,reject);
   entered();
  });
 }});
});

test("drain during DATA SHA awaits one guest turn then tears down exactly once",async()=>{
 const sourceFrame=await encodeActorMessageV2({schemaId,descriptor,value:12n});
 let calls=0,entered,release;
 const suspended=new Promise(resolve=>entered=resolve);
 await endpoint("data-sha-drain",async({dispatch,init,received,spy})=>{
  await init();
  const original=Uint8Array.from(sourceFrame);
  const pending=dispatch({data:{kind:"oreslang-v2-data",id:1,frame:original}});
  await suspended;
  await dispatch({data:{kind:"oreslang-v2-control",action:"drain"}});
  assert.deepEqual(received,[{kind:"oreslang-v2-ready"}],
   "drain may not report STOPPED before the in-flight turn");
  release();
  await pending;
  assert.deepEqual(received,[
   {kind:"oreslang-v2-ready"},
   {kind:"oreslang-v2-receipt",id:1,ok:true,result:12n},
   {kind:"oreslang-v2-stopped"}
  ]);
  assert.equal(spy.messages,1,"in-flight guest executed once");
  assert.equal(spy.teardown,1,"graceful CONTROL drains one guest lifetime");
  assert.ok(original.every(byte=>byte===0),"drained DATA frame scrubbed");
 },{digest:(algorithm,bytes)=>{
  if(++calls===1)return webcrypto.subtle.digest(algorithm,bytes);
  return new Promise((resolve,reject)=>{
   release=()=>webcrypto.subtle.digest(algorithm,bytes).then(resolve,reject);
   entered();
  });
 }});
});
