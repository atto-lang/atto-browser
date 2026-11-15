import { PROTOCOL, assert_tenant_id } from './protocol.mjs';

export class BrowserTenantClient {
  #worker;
  #next = 1;
  #pending = new Map();
  #listeners = new Set();
  #closed = false;
  constructor(worker_url = new URL('./supervisor.worker.mjs', import.meta.url), WorkerCtor = Worker) {
    this.#worker = new WorkerCtor(worker_url, { type: 'module' });
    this.#worker.onmessage = ({ data }) => {
      if (!data || data.protocol !== PROTOCOL) return;
      if (data.event) { for (const callback of this.#listeners) callback(data); return; }
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
  #request(op, data = {}) {
    if (this.#closed) return Promise.reject(new Error('E_CLIENT_CLOSED'));
    const id = this.#next++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      try { this.#worker.postMessage({ protocol: PROTOCOL, id, op, ...data }); }
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
  on_event(callback) {
    if (typeof callback !== 'function') throw new TypeError('listener must be a function');
    this.#listeners.add(callback);
    return () => this.#listeners.delete(callback);
  }
  close() { if (!this.#closed) this.#abort('E_CLIENT_CLOSED'); }
}
