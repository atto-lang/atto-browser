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

The opt-in `npm run test:browser` runner launches **real Chromium and Firefox** via a pinned Playwright package. It hosts the exact browser modules over a local HTTP origin and creates actual dedicated module Workers through the default `workerFactory`; the tests check independent concurrent Workers, byte/hash/provenance rejection, entry ABI and memory policy, snapshot protection against caller mutation, CPU-bound Worker timeout, main-thread responsiveness, and fresh Worker recovery. Run `npx playwright install --with-deps chromium firefox` after installing the pinned `playwright@1.56.1` CI dependency. See `.github/workflows/real-browsers.yml` for GitHub Actions. **Do not treat an installed dependency as a passed test; inspect both engine outcomes and the final SHA-exact source tree.**

Node 22 tests use an isolated worker_threads shim to execute the **unchanged** Worker entry and verify real WebAssembly execution, cancellation deadline and invalid-artifact rejection. This is executed Node Worker evidence, **not** yet real browser-engine E2E evidence.

## Next release gate

Run the same SHA-pinned guest in actual Chromium/Firefox Web Workers via a browser test runner. Then integrate the owned-message envelope v1, bounded actor mailboxes, typed replies, supervisor CONTROL and logical single-flight scheduling. Until those are implemented and tested, do not claim browser actor runtime compatibility.

## Cancellation contract

`signal` is optional and must be AbortSignal-like. If already aborted, the host rejects without creating a Worker. An abort after admission terminates the dedicated Worker, clears its timeout and listeners, and settles once. It does not guarantee that a guest has independently released external side effects; verified core scalar guests currently have zero imports. A future supervised actor protocol must additionally send CONTROL cancellation and reconcile any external ownership transfers.
