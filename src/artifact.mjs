import {inspectWasmBytes} from "./inspect.mjs";
import {loadOreslangWasm} from "./loader.mjs";
import {assertCoreI64Entry} from "./abi.mjs";
import {snapshotCoreManifest} from "./core-manifest-snapshot.mjs";

const hex64=x=>typeof x==="string"&&/^[0-9a-f]{64}$/.test(x);
const shape=(x,names)=>x&&typeof x==="object"&&!Array.isArray(x)&&Object.keys(x).every(k=>names.includes(k));
function checkManifest(original){
 // Capture caller-supplied manifest bytes before the first await. Otherwise
 // changing wasmSha256, entry, or memory after validation can change what
 // the loader admits (manifest TOCTOU), even with immutable Wasm bytes.
 const m=snapshotCoreManifest(original);
 if(!shape(m,["schemaVersion","artifactType","target","environment","backend","entry","wasmSha256","wasmBytes","requiredCapabilities","imports","memory","producer"])||
    m.schemaVersion!==1||m.artifactType!=="oreslang.core-wasm.i64-v1"||
    m.target!=="wasm32"||m.backend!=="wasm"||m.environment!=="browser")
  throw new Error("unsupported/invalid browser core Wasm artifact manifest");
 if(typeof m.entry!=="string"||m.entry.length>128||!/^[A-Za-z_][A-Za-z0-9_]*$/.test(m.entry))
  throw new Error("invalid core Wasm entry export");
 if(!hex64(m.wasmSha256)||!Number.isSafeInteger(m.wasmBytes)||m.wasmBytes<1||m.wasmBytes>16777216)
  throw new Error("invalid core Wasm byte identity");
 if(!Array.isArray(m.imports)||m.imports.length!==0||
    !Array.isArray(m.requiredCapabilities)||m.requiredCapabilities.length!==0)
  throw new Error("core Wasm guest may not declare imports or capabilities");
 if(!shape(m.memory,["maximumPages"])||!Number.isSafeInteger(m.memory.maximumPages)||
    m.memory.maximumPages<1||m.memory.maximumPages>256)
  throw new Error("invalid memory budget");
 if(!shape(m.producer,["compilerSha256","sourceSha256","llvmIrSha256"])||
    !["compilerSha256","sourceSha256","llvmIrSha256"].every(k=>hex64(m.producer[k])))
  throw new Error("invalid producer provenance");
 return Object.freeze({...m,
  imports:Object.freeze(m.imports),
  requiredCapabilities:Object.freeze(m.requiredCapabilities),
  memory:Object.freeze(m.memory),
  producer:Object.freeze(m.producer)});
}
async function digest(bytes){
 const subtle=globalThis.crypto?.subtle;
 if(!subtle)throw new Error("cryptographic SHA-256 unavailable; refusing artifact");
 const result=await subtle.digest("SHA-256",bytes);
 return Array.from(new Uint8Array(result),b=>b.toString(16).padStart(2,"0")).join("");
}
/** Verify content identity, ABI and memory before instantiating a core-i64 guest.
 * The host must still impose CPU/fuel and worker termination policy.
 * Manifests do not prove source-language effects or compiler provenance.
 */
export async function loadVerifiedCoreGuest(rawBytes,manifest,{
 maxModuleBytes=1048576,maxMemoryPages=32,sealedExports=false
}={}){
 if (typeof sealedExports!=="boolean")
  throw new TypeError("sealedExports must be a boolean");
 const m=checkManifest(manifest);
 const checked=inspectWasmBytes(rawBytes,{maxModuleBytes,maxMemoryPages});
 if(checked.bytes.length!==m.wasmBytes)throw new Error("core Wasm artifact byte length mismatch");
 if(await digest(checked.bytes)!==m.wasmSha256)throw new Error("core Wasm artifact SHA-256 mismatch");
 if(checked.memoryCount!==1||!checked.hasMemoryMaximum||
    checked.memoryMaximum!==m.memory.maximumPages)
  throw new Error("core Wasm artifact memory does not match declared maximum");
 const module=new WebAssembly.Module(checked.bytes);
 if(WebAssembly.Module.imports(module).length!==0)throw new Error("core Wasm guest imports forbidden");
 if(!WebAssembly.Module.exports(module).some(x=>x.name===m.entry&&x.kind==="function"))
  throw new Error("core Wasm entry export missing");
 // The strict scalar AOT profile has a closed export surface:
 // exactly main() and one private memory. Reject debug/injected exports
 // before host instantiation so they cannot accidentally become a
 // guest-visible capability or an open-world tree-shake root.
 if(sealedExports){
  if(m.entry!=="main")
   throw new Error("sealed scalar AOT requires exact main entry");
  const all=WebAssembly.Module.exports(module);
  if(all.length!==2 ||
     !all.some(x=>x.name==="main"&&x.kind==="function") ||
     !all.some(x=>x.name==="memory"&&x.kind==="memory"))
    throw new Error("sealed scalar AOT requires only main and memory exports");
 }
 // Check the actual Wasm function type, not merely its export name.
 assertCoreI64Entry(checked.bytes,m.entry);
 const {instance}=await loadOreslangWasm(checked.bytes,{
  requestedCapabilities:[],grantedCapabilities:[],
  requireRuntimeABI:false,maxModuleBytes,maxMemoryPages
 });
 return {module,instance,entry:instance.exports[m.entry],manifest:m};
}
