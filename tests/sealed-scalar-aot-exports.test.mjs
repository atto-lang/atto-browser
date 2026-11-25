import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {loadVerifiedCoreGuest} from "../src/artifact.mjs";

const section = (id,body) => [id,body.length,...body];
const name = text => [text.length,...new TextEncoder().encode(text)];
const fixture = ({extra=false,renamed=false}={}) => Uint8Array.of(
  0,97,115,109,1,0,0,0,
  ...section(1,[1,0x60,0,1,0x7e]),
  ...section(3,[1,0]),
  ...section(5,[1,1,2,2]),
  ...section(7,[
    extra?3:2,
    ...name(renamed?"calculate":"main"),0,0,
    ...name("memory"),2,0,
    ...(extra?[...name("diagnostic"),0,0]:[])
  ]),
  ...section(10,[1,4,0,0x42,42,0x0b])
);
const manifest = (bytes,entry="main") => {
  const sha=createHash("sha256").update(bytes).digest("hex");
  return {schemaVersion:1,artifactType:"oreslang.core-wasm.i64-v1",
    target:"wasm32",environment:"browser",backend:"wasm",entry,
    wasmSha256:sha,wasmBytes:bytes.length,imports:[],
    requiredCapabilities:[],memory:{maximumPages:2},
    // Synthetic host fixtures prove validation mechanics only: these are
    // NOT independently authenticated real compiler/source provenance.
    producer:{compilerSha256:sha,sourceSha256:sha,llvmIrSha256:sha}};
};

test("closed-export scalar profile admits bounded zero-import wasm32 main",async()=>{
 const bytes=fixture();
 assert.equal(WebAssembly.validate(bytes),true);
 const {entry,module}=await loadVerifiedCoreGuest(bytes,manifest(bytes),{sealedExports:true});
 assert.equal(entry(),42n);
 assert.deepEqual(WebAssembly.Module.imports(module),[]);
 assert.deepEqual(WebAssembly.Module.exports(module).map(x=>x.name),["main","memory"]);
});

test("closed-export profile rejects otherwise-valid diagnostic export",async()=>{
 const bytes=fixture({extra:true});
 assert.equal(WebAssembly.validate(bytes),true);
 // Compatibility mode continues to accept existing pure modules, avoiding
 // unreviewed changes to the preexisting v1 browser artifact ABI.
 const compatible=await loadVerifiedCoreGuest(bytes,manifest(bytes));
 assert.equal(compatible.entry(),42n);
 await assert.rejects(
  loadVerifiedCoreGuest(bytes,manifest(bytes),{sealedExports:true}),
  /requires only main and memory exports/
 );
});

test("sealed profile cannot select an arbitrary exported i64 function",async()=>{
 const bytes=fixture({renamed:true});
 assert.equal(WebAssembly.validate(bytes),true);
 await assert.rejects(
  loadVerifiedCoreGuest(bytes,manifest(bytes,"calculate"),{sealedExports:true}),
  /requires exact main entry/
 );
});

test("sealing cannot be silently disabled through malformed option",async()=>{
 const bytes=fixture({extra:true});
 for(const bad of [null,undefined,0,"false",{},[]]){
  if(bad===undefined)continue; // unspecified flag defaults to compatibility
  await assert.rejects(
   loadVerifiedCoreGuest(bytes,manifest(bytes),{sealedExports:bad}),
   /sealedExports must be a boolean/
  );
 }
});
