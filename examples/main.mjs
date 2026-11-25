import {loadOreslangWasm} from "../src/loader.mjs";
const output=document.querySelector("#result");
try{
 const bytes=await (await fetch("./oreslang_rt.wasm")).arrayBuffer();
 const rt=await loadOreslangWasm(bytes,{
  requestedCapabilities:["clock"],grantedCapabilities:["clock"],
  host:{clockMs:()=>performance.now()}
 });
 output.textContent="Oreslang core WASM ABI "+rt.instance.exports.ores_rt_abi_version()+
    "; 2 + 3 = "+rt.instance.exports.ores_rt_add(2,3)+
    "; clock = "+rt.instance.exports.ores_rt_clock_ms();
}catch(error){output.textContent="Failed: "+error.message;console.error(error)}
