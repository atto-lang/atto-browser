# atto-browser — one Web Worker per tenant (experimental)

The browser host starts **one dedicated supervisor Web Worker**; the supervisor spawns **one dedicated tenant Web Worker per tenant**. Within a Wasm tenant, each actor gets an independent Wasm instance, globals, and linear memory, but actors are cooperatively dispatched on that tenant's single browser thread.

```js
import { BrowserTenantClient } from './src/client.mjs';
const app = new BrowserTenantClient();
app.on_event(event => console.log(event));
const handle = await app.spawn('tenant_a', {backend:'wasm', entry:'/guest.wasm'});
const result = await app.call(handle); // calls guest main(), once per incarnation
await app.stop(handle);
app.close();
```

**Compatibility:** accepts the bounded Rust `atto-source.rs` browser guest ABI (`main: () -> i64`, optional `actor_init`/`actor_receive`, `atto` print and actor imports). JS backend accepts an ES module exporting `async function create_tenant({tenant,generation})` returning an object with `on_message()`; JS requires `trusted:true` because a Web Worker is **not a JavaScript security sandbox**. `trusted:true` is an API declaration, not a security authorization mechanism.

**Fail-closed defaults:** strict same-origin HTTP(S) or `blob:` module URL (to support in-browser compilation without uploads); limited Wasm function imports; no cross-tenant message forwarding; actor and mailbox limits; per-tenant request serialization; worker watchdog timeout and termination; bounded restart and monotonically increasing incarnation. No SharedArrayBuffer is needed for v1. Worker IDs are not authority tokens.

**Current limitations:** This is a worker-runtime integration slice, not a complete JS source transpiler, proof of memory-sandbox isolation, or cross-backend parity. It runs one `main()` per Wasm tenant incarnation; subsequent calls fail. Actor scheduling is synchronous and not preemptive within one tenant. An infinite loop is stopped by terminating the tenant worker from the separate supervisor. Cross-tenant transfers, actor-level supervision/control notices, zero-copy buffers, service-worker background work, crash-state restoration, Rust compiler-produced bundle manifests, and tenant-specific permissions are future work.

**Service Worker:** intentionally not the live supervisor because browsers may suspend/terminate Service Workers when idle. An optional Service Worker can implement offline cache, update events, and durable notifications, but cannot be relied upon to keep actor supervision alive.

Run host-unit tests: `npm test` (Node 20+). Browser end-to-end and compiled Atto guest conformance tests remain required before claiming production readiness.

### Incarnation-bound handles

The supervisor issues `{tenant,generation,capability}` when a tenant becomes ready. `call(handle)` and `stop(handle)` require that exact handle; a tenant name is not enough. A restart invalidates the old handle. Subscribe to `on_event` and use the new `tenant_ready` event's `tenant`, `generation`, and `capability` for subsequent requests. Random capability values defend against accidental/stale references *within the application's trusted origin*, not hostile JavaScript already executing in that same origin.

### Bounded Wasm policy

The v1 Wasm loader requires fixed non-growing linear memory (at most 16 Wasm pages = 1 MiB per instance), no Wasm tables, an allowed `atto` function import set, and a consistent compiler-produced `atto.actors` custom section. A tenant can instantiate up to 64 actor instances. CPU watchdog protection applies at the worker level, not individual actor execution; worker termination reclaims all tenant actors.
