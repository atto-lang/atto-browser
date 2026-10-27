const ordinaryBufferLength=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,"byteLength").get;
function isOrdinaryBuffer(buffer){
 try{ordinaryBufferLength.call(buffer);return true;}catch{return false;}
}
const typedPrototype=Object.getPrototypeOf(Uint8Array.prototype);
const viewBuffer=Object.getOwnPropertyDescriptor(typedPrototype,"buffer").get;
const viewOffset=Object.getOwnPropertyDescriptor(typedPrototype,"byteOffset").get;
const viewLength=Object.getOwnPropertyDescriptor(typedPrototype,"byteLength").get;
const dataBuffer=Object.getOwnPropertyDescriptor(DataView.prototype,"buffer").get;
const dataOffset=Object.getOwnPropertyDescriptor(DataView.prototype,"byteOffset").get;
const dataLength=Object.getOwnPropertyDescriptor(DataView.prototype,"byteLength").get;
/**
 * Small, bounded reader for the pieces of core Wasm required to enforce
 * loader policy. This is *not* a general Wasm parser or execution sandbox.
 */
export function inspectWasmBytes(input,{maxModuleBytes=1048576,maxMemoryPages=32}={}){
 if(!Number.isSafeInteger(maxModuleBytes)||maxModuleBytes<8||maxModuleBytes>16*1024*1024)throw new TypeError("invalid maximum module size");
 if(!Number.isSafeInteger(maxMemoryPages)||maxMemoryPages<1||maxMemoryPages>256)throw new TypeError("invalid maximum memory pages");
 if(input instanceof WebAssembly.Module)throw new TypeError("precompiled WebAssembly.Module cannot be inspected: provide original bytes");
 let bytes;
 // Trust the intrinsic ArrayBuffer slot, never a spoofable prototype chain.
 // A SharedArrayBuffer can have its prototype replaced with ArrayBuffer.prototype.
 if(isOrdinaryBuffer(input))bytes=new Uint8Array(input);
 else if(ArrayBuffer.isView(input)){
  // A concurrently writable SharedArrayBuffer can race input admission.
  // Only caller-owned, non-shared bytes may be snapshotted for verification.
  const dataView=input instanceof DataView;
  const buffer=(dataView?dataBuffer:viewBuffer).call(input);
  const offset=(dataView?dataOffset:viewOffset).call(input);
  const length=(dataView?dataLength:viewLength).call(input);
  if(!isOrdinaryBuffer(buffer))
   throw new TypeError("shared Wasm input memory is not admitted");
  bytes=new Uint8Array(buffer,offset,length);
 }
 else throw new TypeError("expected a Wasm ArrayBuffer or typed array");
 if(bytes.byteLength>maxModuleBytes)throw new Error("Wasm module exceeds maximum byte size");
 // Snapshot any supplied view before inspecting; never validate bytes that can
 // change between admission and WebAssembly.Module compilation (TOCTOU).
 bytes=Uint8Array.from(bytes);
 const fail=message=>{throw new Error("Wasm admission denied: "+message)};
 if(bytes.length<8||bytes[0]!==0||bytes[1]!==97||bytes[2]!==115||bytes[3]!==109||
    bytes[4]!==1||bytes[5]!==0||bytes[6]!==0||bytes[7]!==0)fail("invalid core module header");
 let at=8;
 const u32=end=>{
  let value=0;
  for(let i=0;i<5;i++){
   if(at>=end)fail("truncated unsigned integer");
   const b=bytes[at++];
   if(i===4&&(b&0xf0)!==0)fail("invalid u32 encoding");
   value+=(b&0x7f)*2**(7*i);
   if((b&0x80)===0)return value;
  }
  fail("overlong unsigned integer");
 };
 let memoryCount=0,hasMemoryMaximum=false,memoryInitial=0,memoryMaximum=0;
 while(at<bytes.length){
  const id=bytes[at++];
  const length=u32(bytes.length);
  const end=at+length;
  if(end>bytes.length)fail("section extends beyond module");
  if(id===8)fail("start section is forbidden (runs before host admission completes)");
  if(id===4)fail("table section is not yet admitted");
  if(id===5){
   const count=u32(end);
   memoryCount+=count;
   if(count>1)fail("more than one memory");
   if(count===1){
    const flags=u32(end);
    if(flags!==1)fail("memory requires fixed initial and maximum limits; shared/memory64 forbidden");
    memoryInitial=u32(end);memoryMaximum=u32(end);
    hasMemoryMaximum=true;
    if(memoryInitial>memoryMaximum||memoryMaximum>maxMemoryPages)fail("linear memory exceeds host budget");
   }
   if(at!==end)fail("malformed memory section");
  }
  at=end;
 }
 if(!WebAssembly.validate(bytes))fail("invalid WebAssembly module");
 return {bytes,memoryCount,hasMemoryMaximum,memoryInitial,memoryMaximum};
}
