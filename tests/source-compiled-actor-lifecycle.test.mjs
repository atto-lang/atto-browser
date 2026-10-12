import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";

// Valid small Wasm32 module with one fixed (1..2 pages) private memory.
// Stubbed Wasm compilation tests the endpoint's async lifecycle, not LLVM.
const moduleBytes=Uint8Array.from([0,97,115,109,1,0,0,0,5,4,1,1,1,2]);
const hash=createHash("sha256").update(moduleBytes).digest("hex");
const digestBytes=Uint8Array.from(createHash("sha256").update(moduleBytes).digest()).buffer;
const names=["oreslang_wasm_actor_init","oreslang_wasm_actor_on_message",
 "oreslang_wasm_actor_teardown"];
const contract={schemaId:"actor.Counter#variant=1",descriptor:"I"};

async function verifyInterruptedInit(stage){
 const descriptors=["self","crypto","WebAssembly"].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]);
 let handler,digestStarted,releaseDigest,compileStarted,releaseCompile;
 let compilations=0,instances=0,inits=0,teardowns=0;
 const events=[];
 const digestEntered=new Promise(resolve=>digestStarted=resolve);
 const compileEntered=new Promise(resolve=>compileStarted=resolve);
 const digestWait=new Promise(resolve=>releaseDigest=resolve);
 const compileWait=new Promise(resolve=>releaseCompile=resolve);
 const fakeModule={};
 const fakeWebAssembly={
  validate(){return true},
  compile(){compilations++;compileStarted();return compileWait},
  Module:{
   imports(){return []},
   exports(){return names.map(name=>({name,kind:"function"}))}
  },
  Instance:class{
   constructor(){
    instances++;
    this.exports={
     oreslang_wasm_actor_init(){inits++},
     oreslang_wasm_actor_on_message(){return 1n},
     oreslang_wasm_actor_teardown(){teardowns++}
    };
   }
  }
 };
 try{
  Object.defineProperty(globalThis,"self",{configurable:true,value:{
   addEventListener(kind,fn){if(kind==="message")handler=fn},
   postMessage(message){events.push(message)}
  }});
  Object.defineProperty(globalThis,"crypto",{configurable:true,value:{subtle:{
   digest(){digestStarted();return digestWait}
  }}});
  Object.defineProperty(globalThis,"WebAssembly",{configurable:true,value:fakeWebAssembly});
  await import("../src/source-compiled-actor-worker.mjs?panic-stage="+stage);
  const wasm=Uint8Array.from(moduleBytes);
  const starting=handler({data:{kind:"oreslang-v2-source-init",...contract,
   wasm,wasmSha256:hash}});
  await digestEntered;
  if(stage==="digest"){
   const ignored=Uint8Array.from([42,43,44]);
   await handler({data:{kind:"oreslang-v2-data",id:1,frame:ignored}});
   assert.ok(ignored.every(b=>b===0),"interleaved DATA frame must be scrubbed");
   releaseDigest(digestBytes);
  }else{
   releaseDigest(digestBytes);
   await compileEntered;
   // A CONTROL message during LOADING currently causes terminal panic.
   await handler({data:{kind:"oreslang-v2-control",action:"drain"}});
   releaseCompile(fakeModule);
  }
  await starting;
  // Terminal state is absorbing even if a forged valid INIT arrives later.
  const late=Uint8Array.from(moduleBytes);
  await handler({data:{kind:"oreslang-v2-source-init",...contract,wasm:late,wasmSha256:hash}});
  assert.ok(late.every(b=>b===0),"late INIT bytes scrubbed after terminal panic");
  assert.ok(wasm.every(b=>b===0),"interrupted INIT bytes scrubbed");
  assert.deepEqual(events,[{kind:"oreslang-v2-panic"}],
   "terminal panic must never be followed by READY or DATA receipt");
  assert.equal(instances,0,"post-panic Wasm instantiation forbidden");
  assert.equal(inits,0,"post-panic guest init forbidden");
  assert.equal(teardowns,0,"uninitialized guest has nothing to tear down");
  assert.equal(compilations,stage==="digest"?0:1,
   "no unnecessary compilation after digest cancellation");
 }finally{
  for(const [name,descriptor] of descriptors){
   if(descriptor)Object.defineProperty(globalThis,name,descriptor);
   else delete globalThis[name];
  }
 }
}
test("terminal panic during SHA-256 cannot compile, instantiate or initialize guest",
 ()=>verifyInterruptedInit("digest"));
test("terminal panic during WebAssembly.compile cannot instantiate or initialize guest",
 ()=>verifyInterruptedInit("compile"));
