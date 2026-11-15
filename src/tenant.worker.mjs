import { PROTOCOL, assert_entry_url, error_text } from './protocol.mjs';
import { open_wasm_tenant } from './wasm-tenant.mjs';

let state=null;
self.onmessage=async({data})=>{
  if(!data || data.protocol!==PROTOCOL)return;
  if(data.op==='boot'){
    if(state!==null)return;
    const {tenant,generation,backend,trusted}=data;
    try{
      const entry=assert_entry_url(data.entry,self.location.origin);
      if(backend==='wasm') state={tenant,generation,handler:await open_wasm_tenant(entry)};
      else if(backend==='js' && trusted===true){
        const module=await import(entry);
        if(typeof module.create_tenant!=='function')throw new Error('E_JS_FACTORY');
        const handler=await module.create_tenant({tenant,generation});
        if(typeof handler?.on_message!=='function')throw new Error('E_JS_HANDLER');
        state={tenant,generation,handler};
      }else throw new Error('E_BACKEND');
      self.postMessage({protocol:PROTOCOL,op:'ready',tenant,generation});
    }catch(e){self.postMessage({protocol:PROTOCOL,op:'boot_failed',tenant,generation,error:error_text(e)});}
    return;
  }
  if(!state || data.tenant!==state.tenant || data.generation!==state.generation)return;
  if(data.op==='call'){
    try{
      const result=await state.handler.on_message();
      self.postMessage({protocol:PROTOCOL,op:'result',id:data.id,generation:state.generation,ok:true,result});
    }catch(e){
      self.postMessage({protocol:PROTOCOL,op:'result',id:data.id,generation:state.generation,ok:false,error:error_text(e)});
    }
  }
};
