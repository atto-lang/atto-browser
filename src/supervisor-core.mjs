import { PROTOCOL, MAX_TENANTS, assert_entry_url, assert_request, error_text, normalize_guest_result } from './protocol.mjs';
import { MAX_ROUTES, MAX_ROUTE_INFLIGHT, assert_route_id, assert_route_capability,
  assert_route_buffer, assert_route_target } from './route-protocol.mjs';

// Run in a dedicated Web Worker. Service Workers can be terminated by browsers.
export class TenantSupervisor {
  constructor({ create_worker, reply, event = () => {}, origin, boot_timeout_ms = 3000,
                call_timeout_ms = 3000, restart_limit = 1 }) {
    if (typeof create_worker !== 'function' || typeof reply !== 'function') throw new TypeError('worker and reply required');
    if (![boot_timeout_ms,call_timeout_ms].every(x=>Number.isSafeInteger(x) && x>=1 && x<=60000) ||
        !Number.isSafeInteger(restart_limit) || restart_limit<0 || restart_limit>3) throw new Error('E_SUPERVISOR_OPTIONS');
    this.create_worker = create_worker;
    this.reply = reply;
    this.event = event;
    this.origin = origin;
    this.boot_timeout_ms = boot_timeout_ms;
    this.call_timeout_ms = call_timeout_ms;
    this.restart_limit = restart_limit;
    this.tenants = new Map();
    this.routes = new Map();
    this.next_route_id = 0;
    this.active_route_sends = 0;
    this.next_generation = 0; // monotonic supervisor-wide; never reissue incarnation
  }
  handle(raw) {
    let msg;
    try { msg = assert_request(raw); }
    catch (e) { if (Number.isSafeInteger(raw?.id)) this.#reply(raw.id, false, undefined, error_text(e)); return; }
    try {
      switch (msg.op) {
        case 'list': this.#reply(msg.id, true, [...this.tenants.values()].map(t => ({tenant:t.id,generation:t.generation,ready:t.ready}))); break;
        case 'spawn': this.#spawn(msg); break;
        case 'call': this.#call(msg); break;
        case 'stop': this.#stop(msg); break;
        case 'grant_route': this.#grant_route(msg); break;
        case 'send_route': this.#send_route(msg); break;
        case 'revoke_route': this.#revoke_route(msg); break;
      }
    } catch (e) { this.#reply(msg.id, false, undefined, error_text(e)); }
  }
  #reply(id, ok, result, error) { this.reply({ protocol: PROTOCOL, id, ok, ...(ok ? { result } : { error }) }); }
  #event(name, tenant, generation, reason, capability) {
    this.event({ protocol: PROTOCOL, event: name, tenant, generation,
      ...(reason ? { reason } : {}), ...(capability ? { capability } : {}) });
  }
  #spawn(msg) {
    if (this.tenants.has(msg.tenant)) throw new Error('E_TENANT_EXISTS');
    if (this.tenants.size >= MAX_TENANTS) throw new Error('E_TENANT_LIMIT');
    if (!['wasm', 'js'].includes(msg.backend)) throw new Error('E_BACKEND');
    // JS is same-origin code with origin capabilities, NOT an untrusted sandbox.
    if (msg.backend === 'js' && msg.trusted !== true) throw new Error('E_JS_REQUIRES_TRUST');
    const entry = assert_entry_url(msg.entry, this.origin);
    const state = {id:msg.tenant,backend:msg.backend,entry,trusted:msg.trusted === true,
                   generation:0,capability:null,worker_instance:null,restarts:0,worker:null,
                   pending:null,boot_request:msg.id,ready:false,timer:null};
    this.tenants.set(state.id,state);
    this.#start(state);
  }
  #start(state) {
    if (this.next_generation>=Number.MAX_SAFE_INTEGER) {
      this.#retire(state,'E_GENERATION_EXHAUSTED',true); return;
    }
    state.generation=++this.next_generation;
    // The token is never sent into the tenant worker. It is replaced on each
    // restart, and old handles are permanently invalid.
    state.capability=crypto.randomUUID();
    const generation = state.generation;
    let worker;
    try { worker = this.create_worker(); }
    catch (e) { this.#retire(state,'E_WORKER_CREATE: '+error_text(e),true); return; }
    state.worker = worker;
    state.worker_instance=null;
    state.ready = false;
    worker.onmessage = ({data}) => this.#worker_message(state,generation,data);
    worker.onerror = () => this.#failure(state,generation,'E_WORKER_CRASH');
    worker.onmessageerror = () => this.#failure(state,generation,'E_WORKER_MESSAGE');
    state.timer = setTimeout(() => this.#failure(state,generation,'E_BOOT_TIMEOUT'),this.boot_timeout_ms);
    try { worker.postMessage({protocol:PROTOCOL,op:'boot',tenant:state.id,generation,backend:state.backend,entry:state.entry,trusted:state.trusted}); }
    catch (e) { this.#failure(state,generation,'E_BOOT_POST: '+error_text(e)); }
  }
  #worker_message(state,generation,data) {
    if (this.tenants.get(state.id)!==state || generation!==state.generation || data?.protocol!==PROTOCOL || data.generation!==generation) return;
    if (data.op==='ready' && !state.ready) {
      if (data.tenant!==state.id) {this.#failure(state,generation,'E_WORKER_PROTOCOL');return;}
      if(data.worker_instance!==undefined) {
        if(typeof data.worker_instance!=='string' ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.worker_instance)) {
          this.#failure(state,generation,'E_WORKER_ID');return;
        }
        state.worker_instance=data.worker_instance;
      }
      clearTimeout(state.timer); state.timer=null;
      state.ready=true;
      if (state.boot_request!==null) {
        this.#reply(state.boot_request,true,{tenant:state.id,generation,capability:state.capability,
          ...(state.worker_instance ? {worker_instance:state.worker_instance} : {})});
        state.boot_request=null;
      }
      this.#event('tenant_ready',state.id,generation,undefined,state.capability);
      return;
    }
    if (data.op==='control' && state.ready && state.pending && data.id===state.pending.id) {
      const notice=data.control;
      if(state.backend!=='wasm' || data.tenant!==state.id ||
          notice?.kind!=='panic' || !Number.isSafeInteger(notice.actor_id) ||
          notice.actor_id<1 || notice.actor_id>64 ||
          !Number.isSafeInteger(notice.parent_id) ||
          notice.parent_id<0 || notice.parent_id>64 ||
          typeof notice.actor_type!=='string' || notice.actor_type.length<1 ||
          notice.actor_type.length>256 || typeof notice.reason!=='string' ||
          notice.reason.length>256 || !notice.reason.startsWith('E_GUEST_')) {
        this.#failure(state,generation,'E_CONTROL_PROTOCOL');return;
      }
      if(!state.control_sent) {
        state.control_sent=true;
        this.event({protocol:PROTOCOL,event:'actor_panic',priority:'CONTROL',
          tenant:state.id,generation,actor_id:notice.actor_id,parent_id:notice.parent_id,
          actor_type:notice.actor_type,reason:notice.reason});
      }
      return;
    }
    if(data.op==='route_result' && state.ready && state.pending?.kind==='route' &&
        data.tenant===state.id && data.id===state.pending.id &&
        data.route_id===state.pending.route_id) {
      clearTimeout(state.timer);state.timer=null;
      const pending=state.pending;state.pending=null;
      this.active_route_sends--;
      if(data.ok) {
        let result;
        try {result=normalize_guest_result(data.result)}
        catch {this.#failure(state,generation,'E_ROUTE_RESULT');this.#reply(pending.id,false,undefined,'E_ROUTE_RESULT');return;}
        this.#reply(pending.id,true,{tenant:state.id,generation,
          route_id:pending.route_id,...result});
      } else {
        const reason=typeof data.error==='string' ? data.error.slice(0,512) : 'E_ROUTE_GUEST';
        // Missing actor/handler is a recoverable route error; guest panics and
        // malformed endpoint results terminate the recipient, not the sender.
        if(reason==='E_ACTOR_REF' || reason==='E_ROUTE_UNSUPPORTED' ||
            reason==='E_GUEST_NOT_READY') this.#reply(pending.id,false,undefined,reason);
        else {
          this.#reply(pending.id,false,undefined,reason);
          this.#failure(state,generation,reason);
        }
      }
      return;
    }
    if (data.op==='result' && state.ready && state.pending?.kind==='call' && data.id===state.pending.id) {
      clearTimeout(state.timer);state.timer=null;
      const id=state.pending.id;state.pending=null;
      if (data.ok) {
        let result;
        try { result=normalize_guest_result(data.result); }
        catch { this.#failure(state,generation,'E_GUEST_RESULT',id); return; }
        this.#reply(id,true,{tenant:state.id,generation,...result});
      } else this.#failure(state,generation,typeof data.error==='string' ? data.error.slice(0,512) : 'E_GUEST_PANIC',id);
      return;
    }
    if (data.op==='boot_failed' && !state.ready) {
      this.#failure(state,generation,data.tenant===state.id &&
        typeof data.error==='string' ? data.error.slice(0,512) : 'E_BOOT_FAILED');
    }
  }
  #authorize(msg,state) {
    if (!Number.isSafeInteger(msg.generation) || msg.generation!==state.generation ||
        typeof msg.capability!=='string' || msg.capability!==state.capability)
      throw new Error('E_STALE_TENANT_HANDLE');
  }
  #call(msg) {
    const state=this.tenants.get(msg.tenant);
    if (!state) throw new Error('E_NO_TENANT');
    this.#authorize(msg,state);
    if (!state.ready) throw new Error('E_TENANT_NOT_READY');
    if (state.pending) throw new Error('E_TENANT_BUSY');
    state.pending = { id:msg.id,kind:'call' };
    state.control_sent=false;
    state.timer = setTimeout(()=>this.#failure(state,state.generation,'E_CALL_TIMEOUT'),this.call_timeout_ms);
    try { state.worker.postMessage({protocol:PROTOCOL,op:'call',id:msg.id,generation:state.generation,tenant:state.id}); }
    catch(e) {this.#failure(state,state.generation,'E_CALL_POST: '+error_text(e));}
  }
  #stop(msg) {
    const state=this.tenants.get(msg.tenant);
    if (!state) throw new Error('E_NO_TENANT');
    this.#authorize(msg,state);
    this.#retire(state,'E_STOPPED',false);
    this.#reply(msg.id,true,{tenant:msg.tenant});
  }
  #grant_route(msg) {
    const source=this.tenants.get(msg.tenant);
    if(!source) throw new Error('E_NO_TENANT');
    this.#authorize(msg,source);
    const target_handle=assert_route_target(msg.target);
    const target=this.tenants.get(target_handle.tenant);
    if(!target)throw new Error('E_ROUTE_TARGET');
    this.#authorize(target_handle,target);
    if(source===target)throw new Error('E_ROUTE_SELF');
    if(!source.ready || !target.ready)throw new Error('E_ROUTE_NOT_READY');
    if(this.routes.size>=MAX_ROUTES)throw new Error('E_ROUTE_LIMIT');
    if(!Number.isSafeInteger(msg.actor_id) || msg.actor_id<0 || msg.actor_id>64)
      throw new Error('E_ROUTE_ACTOR');
    if(msg.wire_type==='i64') {
      if(target.backend!=='wasm' || msg.actor_id<1)throw new Error('E_ROUTE_WIRE');
    } else if(msg.wire_type==='bytes') {
      if(target.backend!=='js' || msg.actor_id!==0)throw new Error('E_ROUTE_WIRE');
    } else throw new Error('E_ROUTE_WIRE');
    if(this.next_route_id>=Number.MAX_SAFE_INTEGER)throw new Error('E_ROUTE_ID_EXHAUSTED');
    const id=++this.next_route_id,capability=crypto.randomUUID();
    this.routes.set(id,{id,capability,source,source_generation:source.generation,
      target,target_generation:target.generation,wire_type:msg.wire_type,actor_id:msg.actor_id});
    this.#reply(msg.id,true,{route_id:id,route_capability:capability,wire_type:msg.wire_type,
      actor_id:msg.actor_id,target_tenant:target.id,target_generation:target.generation});
  }
  #route_authorize(msg) {
    const source=this.tenants.get(msg.tenant);
    if(!source)throw new Error('E_NO_TENANT');
    this.#authorize(msg,source);
    const route=this.routes.get(assert_route_id(msg.route_id));
    if(!route || route.capability!==assert_route_capability(msg.route_capability) ||
        route.source!==source || route.source_generation!==source.generation)
      throw new Error('E_ROUTE_INVALID');
    if(this.tenants.get(route.target.id)!==route.target ||
        route.target.generation!==route.target_generation) {
      this.routes.delete(route.id);throw new Error('E_ROUTE_STALE');
    }
    return route;
  }
  #send_route(msg) {
    const route=this.#route_authorize(msg),target=route.target;
    if(!route.source.ready || !target.ready)throw new Error('E_ROUTE_NOT_READY');
    if(msg.wire_type!==route.wire_type)throw new Error('E_ROUTE_WIRE');
    const buffer=assert_route_buffer(msg.buffer,route.wire_type);
    if(target.pending)throw new Error('E_TENANT_BUSY');
    if(this.active_route_sends>=MAX_ROUTE_INFLIGHT)throw new Error('E_ROUTE_BACKPRESSURE');
    // Admission is atomic within the supervisor event loop. No queue is held:
    // callers must await the ack before sending the next ordered message.
    target.pending={id:msg.id,kind:'route',route_id:route.id};
    this.active_route_sends++;
    target.timer=setTimeout(()=>this.#failure(target,target.generation,'E_ROUTE_TIMEOUT'),
      this.call_timeout_ms);
    try {
      // The supervisor moves the ArrayBuffer into exactly one destination
      // worker. No tenant receives the grant capability or source handle.
      target.worker.postMessage({protocol:PROTOCOL,op:'route',
        id:msg.id,tenant:target.id,generation:target.generation,
        route_id:route.id,wire_type:route.wire_type,actor_id:route.actor_id,
        buffer},[buffer]);
    }catch(error){this.#failure(target,target.generation,'E_ROUTE_POST: '+error_text(error))}
  }
  #revoke_route(msg) {
    const route=this.#route_authorize(msg);
    this.routes.delete(route.id);
    // An already-admitted transfer cannot be recalled; the revocation
    // prevents subsequent sends and does not double-reply an in-flight ack.
    this.#reply(msg.id,true,{route_id:route.id,revoked:true});
  }
  #drop_routes(state) {
    for(const [id,route] of this.routes)
      if(route.source===state || route.target===state)this.routes.delete(id);
  }
  #failure(state,generation,reason,request_id=null) {
    if (this.tenants.get(state.id)!==state || state.generation!==generation) return;
    clearTimeout(state.timer);state.timer=null;
    const pending=state.pending;
    state.pending=null;
    if(pending?.kind==='route')this.active_route_sends--;
    this.#drop_routes(state);
    state.worker?.terminate(); state.worker=null;
    if (pending) this.#reply(pending.id,false,undefined,reason);
    else if (request_id!==null) this.#reply(request_id,false,undefined,reason);
    this.#event('tenant_down',state.id,generation,reason);
    if (state.restarts < this.restart_limit) {
      state.restarts++;
      this.#start(state);
    } else {
      this.#retire(state,reason,true);
    }
  }
  #retire(state,reason,failed) {
    clearTimeout(state.timer);state.timer=null;
    state.worker?.terminate();state.worker=null;
    this.tenants.delete(state.id);
    this.#drop_routes(state);
    if(state.pending){
      if(state.pending.kind==='route')this.active_route_sends--;
      this.#reply(state.pending.id,false,undefined,reason);state.pending=null;
    }
    if(state.boot_request!==null){this.#reply(state.boot_request,false,undefined,reason);state.boot_request=null;}
    this.#event(failed?'tenant_failed':'tenant_stopped',state.id,state.generation,reason);
  }
}
