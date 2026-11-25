> **AI agent instructions (organization-wide):** Before working on code, issues, or pull requests, read and follow the [organization `AGENTS.md`](https://github.com/atto-lang/.github/blob/main/AGENTS.md), including its **merge-first stealth-development policy**. Honor any repository-local `AGENTS.md`, explicit holds, and GitHub-enforced rules.

# atto-browser

Browser runtime APIs and JavaScript interoperability for AttoLang applications.

## Naming migration and language authority

This repository is maintained at [atto-lang/atto-browser](https://github.com/atto-lang/atto-browser); use `https://github.com/atto-lang/atto-browser.git` for Git remotes and canonical `.atto` source examples. The normative language contract is [atto-spec](https://github.com/atto-lang/atto-spec), with executable guest evidence tracked by [atto-platform-conformance](https://github.com/atto-lang/atto-platform-conformance). Follow current ownership, borrowing, effects, actor, and syntax rules there; do not infer implemented features from a README or unexecuted CI.

## Scope

Browser integration APIs, worker interoperability, and web security boundaries.

## Compatibility and design

This package is intended to integrate with [AttoLang](https://github.com/atto-lang) while clearly separating portable language behavior from backend- and host-specific features. Document APIs, target restrictions, and security/trust boundaries.

## Development and verification

Refer to checked-in sources and CI workflows for verified build and test commands. Include platform-specific execution tests and publish exact-commit evidence before asserting backend parity or production readiness.

## Project status

This README describes the intended repository scope and does not imply implemented functionality or verified target coverage.

## Related

- [Language specification](https://github.com/atto-lang/atto-spec)
- [Platform conformance](https://github.com/atto-lang/atto-platform-conformance)

## Repository ownership and contribution routing

**Belongs here:** Reusable browser-facing AttoLang APIs, DOM and Web Worker interop, capability-scoped host bridges and browser lifecycle adapters.

**Belongs elsewhere:** JS lowering belongs in atto-source.js, Wasm compiler/runtime lowering in atto-source.wasm, the playground UI/release in atto-playground.

**Security and portability boundary:** Browser worker boundaries are not per-actor memory protection by themselves. Validate messages, bound quotas, reject unsafe host imports, and handle worker termination/cancellation races.

AttoLang is the canonical project name; new source, examples and documentation use `.atto` and the `atto-lang` repository organization. This README defines scope, not feature readiness.

**Acceptance:** name exact source SHA/tree, runtime/toolchain, positive and negative checks and execution receipt before claiming support. Host-only tests and empty CI steps do not prove guest execution.

## Legacy provenance and transfer verification

Related historical browser projects include `ores-truffle-oreslang/oreslang-web-browser.ores` and `ores-truffle-oreslang/oreslang-browser`; their identities and migration histories must be verified separately. The present checkout is `atto-lang/atto-browser`; matching names or imported history do not prove preserved numeric repository identity or runtime parity. Preserve working legacy `.ores` inputs and historical package/CLI aliases until compiler-backed replacements and consumers are verified. New source follows canonical `.atto` contracts.

Browser APIs, embedding and UI experiments belong here; browser-engine security certification and managed browser services do not. [atto-lang](https://github.com/atto-lang) maintains language, portable libraries and tooling; [atto-co](https://github.com/atto-co) separately governs commercial deployment, tenancy, identity and billing. Further original-ID transfers or commercial carve-outs require separate owner authorization and independent security review. This document authorizes no transfer or private-source mirror.

Before an authorized transfer, coordinate in [migration issue #26](https://github.com/ores-truffle-oreslang/.github/issues/26) and review the authorized runbook. Record source and target administrators, numeric repository ID, exact SHA/tree, history, visibility, access and rulesets, PRs/issues, releases, packages, consumers, CI/runners, secrets, deploy keys, apps, webhooks, Pages and rollback ownership. Verify unchanged ID/history/tree and restored controls after transfer, then execute exact-head tests before changing consumers. Zero-step jobs are NOT_EXECUTED; host-only and source-free checks do not certify compiled guest execution or production capabilities.

## Experimental tenant Worker runtime

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

**Fail-closed defaults:** strict same-origin HTTP(S) or `blob:` module URL (to support in-browser compilation without uploads); limited Wasm function imports; no implicit cross-tenant message forwarding; actor and mailbox limits; per-tenant request serialization; worker watchdog timeout and termination; bounded restart and monotonically increasing incarnation. No SharedArrayBuffer is needed for v1. Worker IDs are not authority tokens.

**Current limitations:** This is a worker-runtime integration slice, not a complete JS source transpiler, proof of memory-sandbox isolation, or cross-backend parity. It runs one `main()` per Wasm tenant incarnation; subsequent calls fail. Actor scheduling is synchronous and not preemptive within one tenant. An infinite loop is stopped by terminating the tenant worker from the separate supervisor. General cross-tenant object transfers, actor-level supervision/control notices, physical zero-copy guarantees, service-worker background work, crash-state restoration, Rust compiler-produced bundle manifests, and tenant-specific permissions are future work.

**Service Worker:** intentionally not the live supervisor because browsers may suspend/terminate Service Workers when idle. An optional Service Worker can implement offline cache, update events, and durable notifications, but cannot be relied upon to keep actor supervision alive.

Run host-unit tests: `npm test` (Node 22+). Browser end-to-end and compiled Atto guest conformance tests remain required before claiming production readiness.

### Incarnation-bound handles

The supervisor issues `{tenant,generation,capability}` when a tenant becomes ready. `call(handle)` and `stop(handle)` require that exact handle; a tenant name is not enough. A restart invalidates the old handle. Subscribe to `on_event` and use the new `tenant_ready` event's `tenant`, `generation`, and `capability` for subsequent requests. Random capability values defend against accidental/stale references *within the application's trusted origin*, not hostile JavaScript already executing in that same origin.

### Bounded Wasm policy

The v1 Wasm loader requires fixed non-growing linear memory (at most 16 Wasm pages = 1 MiB per instance), no Wasm tables, an allowed `atto` function import set, and a consistent compiler-produced `atto.actors` custom section. A tenant can instantiate up to 64 actor instances. CPU watchdog protection applies at the worker level, not individual actor execution; worker termination reclaims all tenant actors.

### Real browser supervisor + compiled actor end-to-end

The checked-in test driver starts actual Chromium module Web Workers: a dedicated supervisor and multiple tenant workers. Two different Rust-compiled Wasm actor fixtures run independently, followed by an actor overflow panic. The browser checks that a CONTROL notice precedes `tenant_down`, that restart rotates capabilities and rejects stale handles, that surviving tenants remain healthy, and that shutdown reclaims all workers. The worker ID is a diagnostic nonce, not an authorization token.

Compile the fixture sources with a separately obtained trusted Rust `attoc` compiler (the current `atto-source.rs` implementation), producing `two-actors.wasm` from `tests/fixtures/pass/67-actor-two-instances.atto`, `actor-state.wasm` from `tests/fixtures/pass/61-actor-state.atto`, and `actor-overflow.wasm` from `tests/fixtures/panic/10-actor-overflow.atto`. Set `ATTO_BROWSER_FIXTURE_DIR` to the absolute directory containing those binaries and run `CHROME_BIN=/path/to/chromium npm run test:browser-tenants` under Node 22+. The script never sends source code to the server. The alternate private Actions mirror builds both exact source trees and runs the complete command.

The actor CONTROL message is logically separate from ordinary actor mailbox traffic, but uses the same browser worker `postMessage` scheduling mechanism; it is **not** a separate high-priority browser scheduling primitive. The current failure policy restarts the entire tenant, rather than just the failed actor. Service Workers still are not persistent supervisors.

### Cross-tenant route transport v1 (app-authorized, typed actor delivery)

The application can grant a route **only while it holds both current tenant incarnation handles**. The grant is bound to the sender generation, the destination generation, and a single target actor ID. The supervisor keeps the sender and destination control capabilities private and returns a separate revocable route capability. A stopped or restarted tenant invalidates all its routes.

```js
// Boot both tenants, then run B's main() to spawn its Wasm actors.
const sender = await client.spawn('A', { backend:'wasm', entry:'/a.wasm' });
const receiver = await client.spawn('B', { backend:'wasm', entry:'/b.wasm' });
await client.call(receiver);
const route = await client.grant_route(sender, receiver, { actor_id:1, wire_type:'i64' });
const buf = new ArrayBuffer(8);
new DataView(buf).setBigInt64(0, 3n, true);
const ack = await client.send_route(sender, route, buf, { mode:'take' });
// buf.byteLength === 0: the original buffer has transferred away.
await client.revoke_route(sender, route);
```

For compiled Wasm actors, the only supported remote wire type currently is **signed 64-bit little-endian** (`i64`). The router invokes the existing live actor's `actor_receive` entrypoint in the destination tenant worker. The receiving actor's heap and mailbox state remain private. A separate `bytes` wire type carries up to 64 KiB into explicitly **trusted JavaScript** tenants implementing `on_route({actor_id,wire_type,buffer})`; use `actor_id:0` for that endpoint.

`mode:'take'` uses a transferable `ArrayBuffer`, detaching it in the originating application when the message is admitted to `postMessage`. This is a *transfer-of-ownership API*, not a physical zero-copy guarantee across all browser engines. A rejected or timed-out message does **not** give the original detached buffer back. `mode:'copy'` duplicates the input before transferring and preserves the caller's buffer. `SharedArrayBuffer`, views, oversized or empty buffers, malformed route tokens, and unsupported wire formats are rejected.

Limits: 64 live grants, 64 KiB per message, 16 in-flight deliveries globally and one in-flight operation per destination. There is no unbounded queue; await acknowledgment before sending the next ordered message. Revocation fences *future* sends and cannot recall an already admitted transfer. Restart/stop fences replay using both generations and route capability.

**Scope**: this version is **application-mediated routing to a real compiled actor**. It does not yet compile an AttoLang `actor.send` expression to a remote route import, and does not pretend that the `rt take`/`rt copy` compiler ownership checker currently understands this host API. Trusted JS runs with same-origin browser authority and is not an untrusted-code sandbox. A logical CONTROL notice is not an OS-level scheduling priority lane.

### Compiled AttoLang remote actor sender (experimental)

The Rust compiler now admits the typed `remote_actor(Counter, 1)` expression for `ActorMail<int>`. This produces an opaque negative actor reference used by ordinary `.send(value)`; neither the Wasm guest nor the sender tenant's worker receives a route capability. The application explicitly authorizes and binds the host slot:

```js
const receiver = await client.spawn('receiver', {backend:'wasm',entry:'/receiver.wasm'});
await client.call(receiver); // creates the receiving actor
const sender = await client.spawn('sender',{backend:'wasm',entry:'/sender.wasm'});
const route = await client.grant_route(sender,receiver,{actor_id:1,wire_type:'i64'});
await client.bind_route(sender,route,1);
const receipt = await client.call(sender);
// receipt.remote_acks contains bounded, ordered destination completion notices
```

`client.call(sender)` only succeeds after the supervisor serially delivers and acknowledges each compiled actor send (maximum 16 messages). A missing, revoked, mismatched or restarted route fails closed and restarts the source tenant; the receiver remains isolated. This is **completion of host-side delivery**, not a `Result` available to individual AttoLang `.send()` expressions. Sends are not transactional: a prior message may have been delivered before a subsequent failure. This profile accepts only little-endian signed `i64` messages, static slots and application-issued route capabilities. Browser-level physical zero-copy and compiler ownership/lifetime verification are not claimed.

### Typed remote-send receipts v1

The supervisor, not guest Wasm, issues monotonic correlation IDs and structured `atto.browser.send-receipt.v1` receipts. `send_route()` returns `result.receipt`; a completed compiled-sender `client.call()` returns `remote_receipts` alongside the original `remote_acks`. Each receipt names the source/destination tenant and generation, route ID, destination actor ID, status, and canonical error code; it **never** includes a capability.

Statuses are **`processed`** (receiver handler returned successfully), **`rejected`** (no delivery dispatched) and **`unknown`** (delivery was dispatched but crashed, timed out or could not be confirmed). This is a **processing acknowledgment**, not exactly-once semantics. Do **not automatically retry `unknown`**—the receiver may have applied the message. Earlier processed messages in a batch remain processed even when a later message fails. On remote-send failure the client rejects with the existing `Error.message` and an additional validated `error.failure = {protocol,code,outcome,receipt,prior_receipts}`. The `prior_receipts` list is bounded to 16.

The current `remote_actor(...).send(...)` guest import still returns `void`, and the compiler still rejects `await`. This feature intentionally stops at **host-visible typed receipts** until proper Wasm continuation frames and a genuine guest-visible `Result<int,string>` can be implemented. Transport buffer ownership, no duplicate acknowledgments, restart fencing and unknown processing outcomes remain separate correctness obligations.

## Experimental compiled receiver tenant workers (stacked on atto-source.rs #144)

The new `backend:'receiver'` path executes **only** an opt-in scalar
`attoc --receiver-instance-preview` Wasm module. It does not activate the
production `mtd` compiler or actor-state leases.

Build a receiver Wasm fixture using the exact Rust compiler tree:

```sh
attoc --receiver-instance-preview tests/fixtures/receiver-worker.atto -o receiver-worker.wasm
sha256sum receiver-worker.wasm
```

Pass the resulting **build-pinned** 64-character SHA-256 in the app-authorized
`spawn` request, not a checksum calculated from a remote untrusted download:

```js
const actor=await client.spawn('my_tenant',{
  backend:'receiver',
  entry:'/guests/receiver-worker.wasm',
  owner:'Worker',
  sha256:RELEASE_MANIFEST_SHA256
});
const answer=await client.call_receiver(actor,'double',21n); // answer.value === '42'
```

The supervisor authorizes calls using its existing tenant capability and
monotonic generation, before forwarding a bounded method name and signed i64
arguments. Only the **tenant worker** receives and holds the Wasm receiver
binding token. Wrong-method attempts are rejected before guest execution.
Checked guest overflow emits a typed CONTROL notice before the tenant is
retired/restarted, fencing old handles. Healthy siblings survive.

Each tenant worker contains **one** receiver actor Wasm instance in this
milestone. The adapter does not offer arbitrary program entry, mailbox
routing, actor-state mutation or an actor-owned heap. `on_control` events are
the existing browser supervisor's logical priority envelope, not a physical
hard-real-time priority lane. A trusted application must supply the tenant
authority and pinned artifact digest. Same-origin workers do not sandbox
hostile same-origin JavaScript. State/lease-bearing `mtd` stays rejected.

For executed real Chromium coverage:
`ATTO_BROWSER_FIXTURE_DIR=/path/to/compiled/guests npm run test:browser-receiver`.

### Receiver ABI and CONTROL hardening

The compiler-pinned module must expose **only** `panic_code`,
`atto.actor_close`, `atto.bind.<Actor>`, and
`atto.receiver.<Actor>.<method>.<arity>`; unknown exports or methods without
a matching binder are rejected even if the Wasm bytes have a valid matching
SHA-256. Actor/method identifiers are capped at 256 ASCII characters.
Supervisor receiver results must have exactly one actor, no stdout, and a
canonical decimal signed 64-bit return. CONTROL notices from a receiver worker
must identify its bound actor (`actor_id=1,parent_id=0`) and the exact owner;
a guest trap error without a preceding CONTROL envelope is treated as a
protocol violation, never a proven panic notification.

These rules apply only to the immutable, scalar, one-actor-per-worker preview.
They do not authorize mutable actor state, production mailbox scheduling, or
lease cleanup.
