# Experimental isolated typed actor Worker (reference JavaScript)

The `@oreslang/browser/owned-actor` entry provides `createOwnedActorWorker()`.
This is a real dedicated module Worker running a JavaScript reference
`Compute -> Result` handler, **not** LLVM/GraalVM-compiled Oreslang and not
a production supervisor runtime.

## The owned boundary

Host source `src/owned-actor-host.mjs` and Worker
`src/owned-actor-worker.mjs` exchange **only** SHA-256-checked ORM1 copied
binary envelopes. They share no actor state or mutable memory. The worker
loads exact vetted source Git blobs, copied from Wasm #16:

- `src/owned-message/owned-envelope.mjs`: source blob
  `c9f4f6031cc6b3cfbbb2d2015b19d5d797433190`
- `src/owned-message/serial-actor-reference.mjs`: source blob
  `2e4a7dcead0bc5eb4871281af126ee189be8d875`

These source pins establish byte provenance for the host reference code, not
any guest compiler toolchain or native ABI.

The Worker admits a schema containing typed `Compute(text: string,n: i64)`
and `Result(text: string,n: i64)`, then uses explicit
`self.respond(Result(...))` and `self.done()` in the serial reference
handler. Merely returning a value would not reply. A `Result` message sent
as a new inbound request fails closed, as does any invalid schema or
version/hash/payload.

## Host admission and lifetime

- One dedicated isolated Worker holds one serial mailbox.
- The caller supplies a host-trusted `workerFactory`, or the browser host
  creates its same-origin relative module Worker.
- Handshake, response correlation IDs, malformed/unsolicited replies,
  bounded in-flight requests, memory/message size and host-side deadlines
  are checked. Concurrent message transmission is FIFO across WebCrypto
  asynchronous hashing.
- On timeout or protocol violation the host terminates the entire Worker,
  rather than allowing a hung guest to hold the actor lane.
- `close()` terminates the Worker and rejects in-flight work. There is
  deliberately **no** per-message cancellation, state persistence or
  restart supervision yet.
- Node 22 `worker_threads` E2E tests run the **same Worker source** in an
  isolated thread through a minimal shim, and verify typed replies,
  caller-mutation snapshots, ordering, capacity, timeout and malformed
  correlation. This does **not** prove execution in actual Chromium/Firefox.

## Next hard gates

Real Wasm linear-memory pointer/length allocation and owned transfer ABI;
compiler emission of tagged message variants for LLVM and Java/GraalVM;
actor execution-context and structured cancellation; supervisor CONTROL
protocol and durable reply handoff; real browser engines, worker sandbox
resource isolation and cross-backend conformance. Do not promote language
backend capability flags before real compiled fixtures execute.
