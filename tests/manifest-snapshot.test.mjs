import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {loadVerifiedCoreGuest} from "../src/artifact.mjs";
import {snapshotCoreManifest} from "../src/core-manifest-snapshot.mjs";

const section=(id,data)=>[id,data.length,...data];
const name=s=>[s.length,...new TextEncoder().encode(s)];
// Synthetic host fixture: core wasm with bounded 2-page memory, main():i64 -> 42.
// This tests admission races, not compilation by the Oreslang frontend.
const wasm=Uint8Array.from([0,97,115,109,1,0,0,0,
 ...section(1,[1,0x60,0,1,0x7e]),...section(3,[1,0]),
 ...section(5,[1,1,2,2]),...section(7,[2,...name("main"),0,0,...name("memory"),2,0]),
 ...section(10,[1,4,0,0x42,42,0x0b])]);
const h=createHash("sha256").update(wasm).digest("hex");
function manifest(){return {schemaVersion:1,artifactType:"oreslang.core-wasm.i64-v1",
 target:"wasm32",environment:"browser",backend:"wasm",entry:"main",
 wasmSha256:h,wasmBytes:wasm.length,imports:[],requiredCapabilities:[],
 memory:{maximumPages:2},producer:{compilerSha256:h,sourceSha256:h,llvmIrSha256:h}};}

test("manifest admission snapshots all nested fields before asynchronous SHA-256",async()=>{
 const supplied=manifest();
 const pending=loadVerifiedCoreGuest(wasm,supplied);
 supplied.wasmSha256="0".repeat(64);
 supplied.entry="not_the_original_export";
 supplied.memory.maximumPages=256;
 supplied.producer.compilerSha256="invalid";
 supplied.requiredCapabilities.push("clock");
 supplied.imports.push("host.import");
 const result=await pending;
 assert.equal(result.entry(),42n);
 assert.equal(result.manifest.wasmSha256,h);
 assert.equal(result.manifest.entry,"main");
 assert.deepEqual(result.manifest.requiredCapabilities,[]);
 assert.deepEqual(result.manifest.imports,[]);
 assert.equal(result.manifest.memory.maximumPages,2);
 assert.equal(result.manifest.producer.compilerSha256,h);
 assert.equal(Object.isFrozen(result.manifest.memory),true);
});

test("non-JSON and cyclic manifests fail closed before guest execution",async()=>{
 const cycle=manifest();cycle.self=cycle;
 await assert.rejects(loadVerifiedCoreGuest(wasm,cycle),/serialization/);
 await assert.rejects(loadVerifiedCoreGuest(wasm,{...manifest(),wasmSha256:1n}),/serialization/);
});

test("manifest snapshot refuses accessor, hook, inherited and symbol authority without running getters", () => {
 const accessored=manifest();
 let getterCalls=0;
 Object.defineProperty(accessored.producer,"compilerSha256",{
  enumerable:true,configurable:true,get(){getterCalls++;return h;}
 });
 assert.throws(()=>snapshotCoreManifest(accessored),/serialization/);
 assert.equal(getterCalls,0,"manifest reader must not invoke guest getters");

 const hooked=manifest();
 let hookCalls=0;
 Object.defineProperty(hooked,"toJSON",{value(){hookCalls++;return manifest();}});
 assert.throws(()=>snapshotCoreManifest(hooked),/serialization/);
 assert.equal(hookCalls,0,"never execute user-defined toJSON during admission");

 const inherited=manifest();
 inherited.memory=Object.create({maximumPages:2});
 assert.throws(()=>snapshotCoreManifest(inherited),/serialization/);

 const symbolic=manifest();
 Object.defineProperty(symbolic,Symbol("grant"),{value:"filesystem"});
 assert.throws(()=>snapshotCoreManifest(symbolic),/serialization/);
});

test("manifest snapshot makes nested plain data immutable before caller mutation", () => {
 const m=manifest();
 const snapshot=snapshotCoreManifest(m);
 m.memory.maximumPages=100;
 m.requiredCapabilities.push("network");
 m.producer.compilerSha256="0".repeat(64);
 assert.equal(snapshot.memory.maximumPages,2);
 assert.deepEqual(snapshot.requiredCapabilities,[]);
 assert.equal(snapshot.producer.compilerSha256,h);
 assert.equal(Object.isFrozen(snapshot.memory),true);
 assert.equal(Object.isFrozen(snapshot.requiredCapabilities),true);
});

test("array manifest length is read from own descriptor, not attacker Proxy get trap",()=>{
  let reads=0;
  const array=new Proxy([1,2],{
    get(target,key,receiver){if(key==='length'){reads++;throw Error('forged length get');}return Reflect.get(target,key,receiver);}
  });
  assert.deepEqual(snapshotCoreManifest(array),[1,2]);
  assert.equal(reads,0);
  const spoofed=new Proxy([1,2],{get(target,key,receiver){
    if(key==='length')return 0;
    return Reflect.get(target,key,receiver);
  }});
  assert.deepEqual(snapshotCoreManifest(spoofed),[1,2]);
});

test("browser manifest never silently normalizes noncanonical numeric fields",()=>{
 for(const unsafe of [-0,9007199254740992,-9007199254740992,1e25]){
  assert.throws(()=>snapshotCoreManifest({...manifest(),wasmBytes:unsafe}),/serialization/);
 }
 for(const number of [0,1,Number.MAX_SAFE_INTEGER,0.5]){
  assert.equal(snapshotCoreManifest({value:number}).value,number);
 }
});

test('browser manifest refuses prototype-magic keys at any nesting level',()=>{
  for(const key of ['__proto__','prototype','constructor']){
    const top=Object.create(null);
    Object.defineProperty(top,key,{value:{admin:true},enumerable:true,configurable:true});
    assert.throws(()=>snapshotCoreManifest(top),/serialization/,key);
    const nested={manifest:top};
    assert.throws(()=>snapshotCoreManifest(nested),/serialization/,'nested '+key);
  }
  assert.equal(({}).admin,undefined,'no prototype mutation during admission');
  assert.deepEqual({...snapshotCoreManifest({name:'core',version:1})},
    {name:'core',version:1});
});

test("nested arrays and producer metadata refuse noncanonical numbers",()=>{
  for(const value of [-0,Number.MAX_SAFE_INTEGER+1,-Number.MAX_SAFE_INTEGER-1]){
    assert.throws(()=>snapshotCoreManifest({outer:[{inner:value}]}),/serialization/);
    const m=manifest();
    m.producer.buildNumber=value;
    assert.throws(()=>snapshotCoreManifest(m),/serialization/);
  }
  const snapshot=snapshotCoreManifest({outer:[{inner:Number.MAX_SAFE_INTEGER},0.125]});
  assert.equal(Object.getPrototypeOf(snapshot),null);
  assert.equal(Object.getPrototypeOf(snapshot.outer[0]),null);
  assert.equal(snapshot.outer.length,2);
  assert.deepEqual({...snapshot.outer[0]},{inner:Number.MAX_SAFE_INTEGER});
  assert.equal(snapshot.outer[1],0.125);
  assert.equal(Object.isFrozen(snapshot.outer[0]),true);
});

test('manifest object keys reject controls and bidi spoofing at every depth',()=>{
  for(const codepoint of [0,9,10,0x7f,0x85,0x2028,0x202e,0x2066,0x2069]){
    const key='backend'+String.fromCodePoint(codepoint)+'forged';
    const nested=Object.create(null);
    Object.defineProperty(nested,key,{value:'wasm',enumerable:true});
    assert.throws(()=>snapshotCoreManifest(nested),/serialization/);
    assert.throws(()=>snapshotCoreManifest({producer:[nested]}),/serialization/);
  }
  const plain=snapshotCoreManifest({producer:{compiler:'Compilador Å/测试'}});
  assert.equal(plain.producer.compiler,'Compilador Å/测试');
});
