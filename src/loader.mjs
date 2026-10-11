const KNOWN = new Set(["clock"]);
function checkList(name,value) {
 if(!Array.isArray(value)||value.some((x,i)=>typeof x!=="string"||!KNOWN.has(x)||value.indexOf(x)!==i)){
  throw new TypeError(name+" must be a unique list of supported capabilities");
 }
}
function moduleBytes(bytes){
 if(bytes instanceof WebAssembly.Module) return bytes;
 if(bytes instanceof ArrayBuffer||ArrayBuffer.isView(bytes))return new WebAssembly.Module(bytes);
 throw new TypeError("expected a Wasm module, ArrayBuffer or typed array");
}
export async function loadOreslangWasm(bytes,{
 requestedCapabilities=[],
 grantedCapabilities=[],
 host={},
 requireRuntimeABI=true
}={}){
 checkList("requestedCapabilities",requestedCapabilities);
 checkList("grantedCapabilities",grantedCapabilities);
 for(const capability of requestedCapabilities){
  if(!grantedCapabilities.includes(capability))throw new Error("capability not granted by host: "+capability);
 }
 const module=moduleBytes(bytes);
 const imports=WebAssembly.Module.imports(module);
 for(const entry of imports){
  if(entry.module!=="ores_host"||entry.name!=="clock_ms"||entry.kind!=="function"){
   throw new Error("unsupported/unauthorized Wasm import: "+entry.module+"."+entry.name+" ("+entry.kind+")");
  }
 }
 const clockRequested=requestedCapabilities.includes("clock");
 if(clockRequested && typeof host.clockMs!=="function"){
  throw new Error("clock requested but no host.clockMs provider supplied");
 }
 let clockCalls=0;
 const importsObject={ores_host:{
  clock_ms:()=>{
   // Enforcement must happen *inside the host function*, even if guest
   // code calls initialization exports to manipulate its own capability bits.
   if(!clockRequested||!grantedCapabilities.includes("clock"))throw new Error("clock capability denied");
   clockCalls++;
   return host.clockMs();
  }
 }};
 const instance=new WebAssembly.Instance(module,importsObject);
 if(requireRuntimeABI){
  if(typeof instance.exports.ores_rt_abi_version!=="function"||
     instance.exports.ores_rt_abi_version()!==1||
     typeof instance.exports.ores_rt_initialize!=="function"){
   throw new Error("unsupported Oreslang core Wasm ABI version");
  }
  const mask=clockRequested?1:0;
  if(instance.exports.ores_rt_initialize(mask)!==1)throw new Error("Wasm runtime initialization failed");
 }
 return {instance,module,get hostClockCalls(){return clockCalls}};
}
