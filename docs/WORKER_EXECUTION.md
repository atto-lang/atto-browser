# Experimental verified core Wasm Worker execution

src/guest-worker.mjs runs SHA-256-admitted pure core-i64 Wasm in a **dedicated, single-shot browser module Worker**. src/worker-host.mjs provides a bounded runVerifiedCoreGuestInWorker API.

This is not an Oreslang actor or supervisor implementation, is not a browser security sandbox by itself, and does not prove GraalVM/LLVM parity. Its current only expected guest ABI is the zero-import, bounded-memory `oreslang.core-wasm.i64-v1` scalar artifact.

## Host policy

- Verify hash, memory, entry, imports and artifact shape inside the Worker using the existing loadVerifiedCoreGuest loader.
- Use one isolated Worker per invocation, then terminate it on success, rejection, error, message error, timeout, or explicit `AbortSignal` cancellation. An already-aborted request does not spawn a Worker. Subscription races fail closed and listeners are removed on settlement.
- Enforce a parent-side deadline (default 5 seconds, maximum 30 seconds) and module-size/memory limits.
- Copy supplied Wasm bytes and JSON manifest before publishing them to the Worker. No SharedArrayBuffer or transfer-list aliasing.
- Return an exact full-width signed i64 BigInt to the caller. Reject noncanonical, wrong-type and out-of-range Worker results.
- Scrub guest exception text in worker responses. Prevent untrusted guest code from executing on the main thread.
- A custom workerFactory is a trusted host injection point, not an untrusted guest API. Default is a same-origin relative module Worker.

## Example

```js
import {runVerifiedCoreGuestInWorker} from "./src/worker-host.mjs";
const controller = new AbortController();
const value = await runVerifiedCoreGuestInWorker({wasmBytes,manifest,timeoutMs:2000,signal:controller.signal});
// value is a BigInt from the verified scalar guest
```

Node 22 tests use an isolated worker_threads shim to execute the **unchanged** Worker entry and verify real WebAssembly execution, cancellation deadline and invalid-artifact rejection. This is executed Node Worker evidence, **not** yet real browser-engine E2E evidence.

## Next release gate

Run the same SHA-pinned guest in actual Chromium/Firefox Web Workers via a browser test runner. Then integrate the owned-message envelope v1, bounded actor mailboxes, typed replies, supervisor CONTROL and logical single-flight scheduling. Until those are implemented and tested, do not claim browser actor runtime compatibility.

## Cancellation contract

`signal` is optional and must be AbortSignal-like. If already aborted, the host rejects without creating a Worker. An abort after admission terminates the dedicated Worker, clears its timeout and listeners, and settles once. It does not guarantee that a guest has independently released external side effects; verified core scalar guests currently have zero imports. A future supervised actor protocol must additionally send CONTROL cancellation and reconcile any external ownership transfers.


## Real Chromium/Firefox transport smoke test

The real-browser smoke test is deliberately separate from the default Node
Worker-shim suite. Run it with Node 22+, the pinned \`playwright@1.56.1\`
package, and downloaded Chromium/Firefox engines:

\`\`\`sh
npm install --no-save --no-package-lock --ignore-scripts playwright@1.56.1
npx playwright install --with-deps chromium firefox
ORESLANG_WASM_RUNTIME_BINARY=../oreslang-wasm/build/oreslang_rt.wasm \
  node scripts/verify-real-browser-workers.mjs
\`\`\`

The fixture starts a loopback-only, no-store static HTTP server and tests
**real browser module Workers**, concurrent FIFO DATA admission, CONTROL
draining, duplicate-ticket replay rejection, and browser-side loading of
an independently built real Wasm C ABI runtime with the clock capability.
The runtime binary must exist; it is not a stand-in or synthesized by the
smoke test. Both engines must pass: no skip, browser error, or fallback to
Node Worker shims counts as success.

This proves transport and the C-runtime browser loader, **not** execution
of compiler-generated Oreslang actor handlers, Java/LLVM source conformance,
arbitrary guest safety, or a trustworthy sandbox. The browser implementation
still requires supervision, cancellation and actual guest-actor lowering
end-to-end before production release.

## Canonical actor Worker INIT and terminal lifecycle

The experimental actor DATA transport uses the canonical `messagepack-v2.mjs`
`validateActorMessageV2Contract` grammar on **both** sides of the INIT
handshake. The host validates before allocating a Worker; the isolated Worker
validates again before emitting READY. Printable ASCII schema IDs are limited
to 256 bytes and shape descriptors to 4096 bytes, with bounded depth and
canonical shape syntax. No independent copy of the grammar is maintained.

Worker lifecycle states are absorbing: once terminal panic or drain completes,
future INIT/DATA cannot resurrect READY or produce receipts. A terminal DATA
buffer is scrubbed when it is safe to do so. These transport invariants do **not**
prove compiler-level single-flight actor execution, Java/LLVM parity, or
actor-handler suspension/cancellation ownership correctness.
