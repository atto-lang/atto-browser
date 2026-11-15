import { PROTOCOL, assert_entry_url, error_text, normalize_guest_result } from './protocol.mjs';
import { open_wasm_tenant } from './wasm-tenant.mjs';

const worker_instance=crypto.randomUUID(); // diagnostic identity, not a security capability
let state=null, booting=false;
self.onmessage=async({data})=>{
  if(!data || data.protocol!==PROTOCOL)return;
  if(data.op==='boot'){
    if(state!==null || booting)return;
    booting=true;
    const {tenant,generation,backend,trusted}=data;
    try{
      const entry=assert_entry_url(data.entry,self.location.origin);
      if(backend==='wasm') state={tenant,generation,backend,handler:await open_wasm_tenant(entry)};
      else if(backend==='js' && trusted===true){
        const module=await import(entry);
        if(typeof module.create_tenant!=='function')throw new Error('E_JS_FACTORY');
        const handler=await module.create_tenant({tenant,generation});
        if(typeof handler?.on_message!=='function')throw new Error('E_JS_HANDLER');
        state={tenant,generation,backend,handler};
      }else throw new Error('E_BACKEND');
      self.postMessage({protocol:PROTOCOL,op:'ready',tenant,generation,worker_instance});
    }catch(e){self.postMessage({protocol:PROTOCOL,op:'boot_failed',tenant,generation,error:error_text(e)});}
    return;
  }
  if(!state || data.tenant!==state.tenant || data.generation!==state.generation)return;
  if(data.op==='call' && Number.isSafeInteger(data.id) && data.id>0){
    try{
      const result=normalize_guest_result(await state.handler.on_message());
      self.postMessage({protocol:PROTOCOL,op:'result',id:data.id,generation:state.generation,ok:true,result});
    }catch(e){
      if(state.backend==='wasm' && e?.actor_failure?.kind==='panic') {
        // Dedicated CONTROL envelope precedes the failed result. This is a
        // logical priority lane, not a separate browser scheduling priority.
        self.postMessage({protocol:PROTOCOL,op:'control',id:data.id,tenant:state.tenant,
          generation:state.generation,control:e.actor_failure});
      }
      self.postMessage({protocol:PROTOCOL,op:'result',id:data.id,generation:state.generation,
        ok:false,error:error_text(e).slice(0,512)});
    }
  }
};
