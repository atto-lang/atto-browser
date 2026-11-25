import { PROTOCOL, assert_entry_url, error_text, normalize_guest_result } from './protocol.mjs';
import { open_wasm_tenant } from './wasm-tenant.mjs';
import { open_receiver_tenant } from './receiver-tenant.mjs';

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
      if(backend==='wasm') state={tenant,generation,backend,busy:false,handler:await open_wasm_tenant(entry)};
      else if(backend==='receiver') state={tenant,generation,backend,busy:false,
        handler:await open_receiver_tenant(entry,data.owner,data.sha256)};
      else if(backend==='js' && trusted===true){
        const module=await import(entry);
        if(typeof module.create_tenant!=='function')throw new Error('E_JS_FACTORY');
        const handler=await module.create_tenant({tenant,generation});
        if(typeof handler?.on_message!=='function')throw new Error('E_JS_HANDLER');
        state={tenant,generation,backend,trusted:true,busy:false,handler};
      }else throw new Error('E_BACKEND');
      self.postMessage({protocol:PROTOCOL,op:'ready',tenant,generation,worker_instance});
    }catch(e){self.postMessage({protocol:PROTOCOL,op:'boot_failed',tenant,generation,error:error_text(e)});}
    return;
  }
  if(!state || data.tenant!==state.tenant || data.generation!==state.generation)return;
  if(data.op==='bind_route') {
    if(state.backend!=='wasm' || !Number.isSafeInteger(data.slot) ||
       data.slot<1 || data.slot>16 || typeof state.handler.bind_route!=='function')return;
    state.handler.bind_route(data.slot);
    return;
  }
  if(data.op==='call_receiver' && Number.isSafeInteger(data.id) && data.id>0 &&
     state.backend==='receiver') {
    if(state.busy) {
      self.postMessage({protocol:PROTOCOL,op:'receiver_result',
        tenant:state.tenant,generation:state.generation,id:data.id,
        ok:false,error:'E_TENANT_BUSY'});
      return;
    }
    state.busy=true;
    try {
      const result=normalize_guest_result(state.handler.on_receiver(data.method,data.args));
      self.postMessage({protocol:PROTOCOL,op:'receiver_result',id:data.id,
        tenant:state.tenant,generation:state.generation,ok:true,result});
    }catch(error){
      if(error?.actor_failure?.kind==='panic') {
        // Same CONTROL-before-result ordering as other actor guest traps.
        self.postMessage({protocol:PROTOCOL,op:'control',id:data.id,
          tenant:state.tenant,generation:state.generation,
          control:error.actor_failure});
      }
      self.postMessage({protocol:PROTOCOL,op:'receiver_result',id:data.id,
        tenant:state.tenant,generation:state.generation,ok:false,
        error:error_text(error).slice(0,256)});
    }finally {state.busy=false}
    return;
  }
  if(data.op==='call' && Number.isSafeInteger(data.id) && data.id>0){
    if(state.busy) {
      self.postMessage({protocol:PROTOCOL,op:'result',id:data.id,generation:state.generation,
        ok:false,error:'E_TENANT_BUSY'});return;
    }
    state.busy=true;
    try{
      const raw=await state.handler.on_message();
      const result=normalize_guest_result(raw);
      const remote_sends=state.backend==='wasm' &&
        typeof state.handler.take_remote_sends==='function' ?
        state.handler.take_remote_sends() : [];
      self.postMessage({protocol:PROTOCOL,op:'result',id:data.id,
        generation:state.generation,tenant:state.tenant,ok:true,result,remote_sends});
    }catch(e){
      if((state.backend==='wasm' || (state.backend==='js' && state.trusted)) && e?.actor_failure?.kind==='panic') {
        // Dedicated CONTROL envelope precedes the failed result. This is a
        // logical priority lane, not a separate browser scheduling priority.
        self.postMessage({protocol:PROTOCOL,op:'control',id:data.id,tenant:state.tenant,
          generation:state.generation,control:e.actor_failure});
      }
      self.postMessage({protocol:PROTOCOL,op:'result',id:data.id,generation:state.generation,
        ok:false,error:error_text(e).slice(0,512)});
    }finally{state.busy=false}
    return;
  }
  if(data.op==='route' && Number.isSafeInteger(data.id) && data.id>0 &&
      Number.isSafeInteger(data.route_id) && data.route_id>0) {
    if(state.busy) {
      self.postMessage({protocol:PROTOCOL,op:'route_result',id:data.id,tenant:state.tenant,
        generation:state.generation,route_id:data.route_id,ok:false,error:'E_TENANT_BUSY'});
      return;
    }
    state.busy=true;
    try {
      if(typeof state.handler.on_route!=='function')throw new Error('E_ROUTE_UNSUPPORTED');
      const result=normalize_guest_result(await state.handler.on_route({
        actor_id:data.actor_id,wire_type:data.wire_type,buffer:data.buffer
      }));
      self.postMessage({protocol:PROTOCOL,op:'route_result',id:data.id,tenant:state.tenant,
        generation:state.generation,route_id:data.route_id,ok:true,result});
    }catch(e){
      if((state.backend==='wasm' || (state.backend==='js' && state.trusted)) && e?.actor_failure?.kind==='panic') {
        self.postMessage({protocol:PROTOCOL,op:'control',id:data.id,tenant:state.tenant,
          generation:state.generation,control:e.actor_failure});
      }
      self.postMessage({protocol:PROTOCOL,op:'route_result',id:data.id,tenant:state.tenant,
        generation:state.generation,route_id:data.route_id,ok:false,error:error_text(e).slice(0,512)});
    }finally{state.busy=false}
  }
};
