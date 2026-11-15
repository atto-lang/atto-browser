import { PROTOCOL, MAX_TENANTS, assert_entry_url, assert_request, error_text, normalize_guest_result } from './protocol.mjs';

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
                   generation:0,capability:null,restarts:0,worker:null,
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
      clearTimeout(state.timer); state.timer=null;
      state.ready=true;
      if (state.boot_request!==null) {
        this.#reply(state.boot_request,true,{tenant:state.id,generation,capability:state.capability});
        state.boot_request=null;
      }
      this.#event('tenant_ready',state.id,generation,undefined,state.capability);
      return;
    }
    if (data.op==='result' && state.ready && state.pending && data.id===state.pending.id) {
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
    if (data.op==='boot_failed' && !state.ready) this.#failure(state,generation,data.error || 'E_BOOT_FAILED');
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
    state.pending = { id:msg.id };
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
  #failure(state,generation,reason,request_id=null) {
    if (this.tenants.get(state.id)!==state || state.generation!==generation) return;
    clearTimeout(state.timer);state.timer=null;
    const pending=state.pending;
    state.pending=null;
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
    if(state.pending){this.#reply(state.pending.id,false,undefined,reason);state.pending=null;}
    if(state.boot_request!==null){this.#reply(state.boot_request,false,undefined,reason);state.boot_request=null;}
    this.#event(failed?'tenant_failed':'tenant_stopped',state.id,state.generation,reason);
  }
}
