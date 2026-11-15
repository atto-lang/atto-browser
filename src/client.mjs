import { PROTOCOL, assert_tenant_id } from './protocol.mjs';
import { assert_route_id, assert_route_capability, assert_route_buffer } from './route-protocol.mjs';

export class BrowserTenantClient {
  #worker;
  #next = 1;
  #pending = new Map();
  #listeners = new Set();
  #closed = false;
  static MAX_PENDING = 128;
  constructor(worker_url = new URL('./supervisor.worker.mjs', import.meta.url), WorkerCtor = Worker) {
    this.#worker = new WorkerCtor(worker_url, { type: 'module' });
    this.#worker.onmessage = ({ data }) => {
      if (!data || data.protocol !== PROTOCOL) return;
      if (data.event) {
        for (const callback of this.#listeners) {
          // A user callback must never interrupt protocol reply handling or
          // prevent another subscriber from observing a CONTROL notice.
          try {callback(data)} catch(error) {console.error('E_TENANT_EVENT_LISTENER',error)}
        }
        return;
      }
      const entry = this.#pending.get(data.id);
      if (!entry) return;
      this.#pending.delete(data.id);
      if (data.ok) entry.resolve(data.result);
      else entry.reject(new Error(data.error || 'E_UNKNOWN'));
    };
    this.#worker.onerror = () => this.#abort('E_SUPERVISOR_DOWN');
    this.#worker.onmessageerror = () => this.#abort('E_SUPERVISOR_MESSAGE');
  }
  #abort(reason) {
    this.#closed = true;
    for (const { reject } of this.#pending.values()) reject(new Error(reason));
    this.#pending.clear();
    this.#worker.terminate();
  }
  #request(op, data = {}, transfer = []) {
    if (this.#closed) return Promise.reject(new Error('E_CLIENT_CLOSED'));
    if (this.#pending.size>=BrowserTenantClient.MAX_PENDING)
      return Promise.reject(new Error('E_CLIENT_PENDING_LIMIT'));
    if (!Number.isSafeInteger(this.#next) || this.#next>=Number.MAX_SAFE_INTEGER) {
      this.#abort('E_REQUEST_ID_EXHAUSTED');
      return Promise.reject(new Error('E_REQUEST_ID_EXHAUSTED'));
    }
    const id = this.#next++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      try { this.#worker.postMessage({ protocol: PROTOCOL, id, op, ...data },transfer); }
      catch (e) { this.#pending.delete(id); reject(e); }
    });
  }
  // JS modules are trusted same-origin code, never a security sandbox.
  spawn(tenant, { backend = 'wasm', entry, trusted = false } = {}) {
    return this.#request('spawn', { tenant: assert_tenant_id(tenant), backend, entry, trusted });
  }
  // A tenant name alone is not authority. Reuse only a current spawn/ready handle.
  #handle(handle) {
    if (!handle || typeof handle!=='object') throw new Error('E_TENANT_HANDLE');
    const tenant=assert_tenant_id(handle.tenant);
    const generation=handle.generation, capability=handle.capability;
    if (!Number.isSafeInteger(generation) || generation<1 ||
        typeof capability!=='string' || !/^[0-9a-f-]{36}$/i.test(capability))
      throw new Error('E_TENANT_HANDLE');
    return {tenant,generation,capability};
  }
  call(handle) { return this.#request('call', this.#handle(handle)); }
  stop(handle) { return this.#request('stop', this.#handle(handle)); }
  list() { return this.#request('list'); }
  // The application must possess BOTH tenant handles before granting a route.
  // A grant allows a specific source incarnation to reach one target endpoint.
  grant_route(source,target,{actor_id=1,wire_type='i64'}={}) {
    return this.#request('grant_route',{...this.#handle(source),
      target:this.#handle(target),actor_id,wire_type});
  }
  // Bind an opaque integer slot for compiled AttoLang remote_actor(Type,slot).
  // Only the supervisor sees the route capability; guest Wasm sees -slot.
  bind_route(source,route,slot=1) {
    if(!Number.isSafeInteger(slot) || slot<1 || slot>16)
      return Promise.reject(new Error('E_ROUTE_SLOT'));
    try {
      return this.#request('bind_route',{...this.#handle(source),
        route_id:assert_route_id(route.route_id),
        route_capability:assert_route_capability(route.route_capability),slot});
    }catch(error){return Promise.reject(error)}
  }
  // rt take: the ArrayBuffer detaches as soon as postMessage succeeds, even
  // if the destination rejects the send. rt copy: caller keeps its original.
  // SharedArrayBuffer, views and detached/oversized payloads are rejected.
  send_route(source,route,buffer,{mode='take'}={}) {
    if(mode!=='take' && mode!=='copy') return Promise.reject(new Error('E_ROUTE_OWNERSHIP'));
    const wire_type=route?.wire_type;
    if(wire_type!=='i64' && wire_type!=='bytes')
      return Promise.reject(new Error('E_ROUTE_WIRE'));
    try {
      const original=assert_route_buffer(buffer,wire_type);
      const payload=mode==='copy' ? original.slice(0) : original;
      return this.#request('send_route',{...this.#handle(source),
        route_id:assert_route_id(route.route_id),
        route_capability:assert_route_capability(route.route_capability),
        wire_type,buffer:payload},[payload]);
    }catch(error){return Promise.reject(error)}
  }
  revoke_route(source,route) {
    return this.#request('revoke_route',{...this.#handle(source),
      route_id:assert_route_id(route.route_id),
      route_capability:assert_route_capability(route.route_capability)});
  }
  on_event(callback) {
    if (typeof callback !== 'function') throw new TypeError('listener must be a function');
    this.#listeners.add(callback);
    return () => this.#listeners.delete(callback);
  }
  close() { if (!this.#closed) this.#abort('E_CLIENT_CLOSED'); }
}
