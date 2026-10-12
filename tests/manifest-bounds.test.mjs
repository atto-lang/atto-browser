import test from "node:test";
import assert from "node:assert/strict";
import {snapshotCoreManifest} from "../src/core-manifest-snapshot.mjs";
import {loadVerifiedCoreGuest} from "../src/artifact.mjs";
import {runVerifiedCoreGuestInWorker} from "../src/worker-host.mjs";
const wasm=Uint8Array.from([0,97,115,109,1,0,0,0]);
const h="a".repeat(64);
const valid=()=>({schemaVersion:1,artifactType:"oreslang.core-wasm.i64-v1",
 target:"wasm32",environment:"browser",backend:"wasm",entry:"main",
 wasmSha256:h,wasmBytes:8,imports:[],requiredCapabilities:[],
 memory:{maximumPages:2},
 producer:{compilerSha256:h,sourceSha256:h,llvmIrSha256:h}});

test("bounded snapshots are deeply frozen and independent of caller mutation",()=>{
 const m=valid(),snapshot=snapshotCoreManifest(m);
 m.memory.maximumPages=256;m.imports.push("host:net");m.entry="other";
 assert.equal(snapshot.memory.maximumPages,2);
 assert.deepEqual(snapshot.imports,[]);
 assert.equal(snapshot.entry,"main");
 assert.equal(Object.isFrozen(snapshot),true);
 assert.equal(Object.isFrozen(snapshot.memory),true);
});

test("oversized strings and arrays fail before any Worker creation",async()=>{
 let spawned=0;
 const spawn=()=>{spawned++;throw Error("must not spawn")};
 const malformed=[
  {...valid(),entry:"x".repeat(5*1024*1024)},
  {...valid(),imports:Array(33).fill("clock")},
  {...valid(),producer:{...valid().producer,extra:"x".repeat(10000)}}
 ];
 for(const manifest of malformed){
  assert.throws(()=>runVerifiedCoreGuestInWorker({wasmBytes:wasm,manifest,workerFactory:spawn}),
   /invalid browser core Wasm manifest serialization/);
  await assert.rejects(loadVerifiedCoreGuest(wasm,manifest),
   /invalid browser core Wasm manifest serialization/);
 }
 assert.equal(spawned,0);
});

test("manifest getters, toJSON, cycles and symbols are rejected without executing hooks",async()=>{
 let invocations=0;
 const getter=valid();
 Object.defineProperty(getter,"wasmSha256",{enumerable:true,get(){invocations++;return h}});
 const hook=valid();hook.toJSON=()=>{invocations++;return valid()};
 const cycle=valid();cycle.extra=cycle;
 const symbol=valid();symbol.extra=Symbol("no-json");
 const sparse=valid();sparse.imports=Array(2);
 const inherited=Object.create({});Object.assign(inherited,valid());
 for(const manifest of [getter,hook,cycle,symbol,sparse,inherited]){
  assert.throws(()=>runVerifiedCoreGuestInWorker({wasmBytes:wasm,manifest,workerFactory:()=>{invocations++;throw Error("must not spawn")}}),
   /invalid browser core Wasm manifest serialization/);
  await assert.rejects(loadVerifiedCoreGuest(wasm,manifest),
   /invalid browser core Wasm manifest serialization/);
 }
 assert.equal(invocations,0);
});

test("null prototypes stay data-only; traversal rejects deeply nested manifests",()=>{
 const nullProto=Object.assign(Object.create(null),valid());
 assert.equal(snapshotCoreManifest(nullProto).entry,"main");
 let nested={value:"leaf"};
 for(let i=0;i<8;i++)nested={next:nested};
 const hostile={...valid(),unexpected:nested};
 assert.throws(()=>snapshotCoreManifest(hostile),/serialization/);
});
