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


## Compiled synchronous source actors — process-local incarnation gate

PR #14 adds a separately typed `oreslang.core-wasm.actor-i64-v1` artifact
and one Wasm instance per dedicated Worker. This is distinct from scalar
`main()` and does not permit source-level suspension or actor spawning.

The host must provide a stable, non-secret `actorKey` to
`createActorMessageTransport({schemaId,descriptor:"I",guest,actorKey})`.
Within one JavaScript agent, this key is admitted at most once until
**either** an awaitable Worker retirement has resolved **or** the actor's
trusted STOPPED CONTROL receipt proves that guest execution and teardown
have already completed.

Node worker_threads adapters provide an awaitable `terminate()`.
Browser `Worker.terminate()` returns **void** and cannot prove that an
aborted or noncooperative guest has exited. In that case cancellation,
terminal PANIC or a failed adapter keeps the identity reserved, and
`get_done()` rejects with unconfirmed retirement. Only a validated clean
STOPPED receipt allows an identity to be released after void termination.
This deliberately fails closed rather than incorrectly licensing an
overlapping replacement on another Worker.

The parent Browser integration also experiments with
`oreslang-v2-source-init` and the separate
`oreslang_wasm_actor_{init,on_message,teardown}` export ABI. It is
**not** interchangeable with the actor-specific `actor-i64-v1` manifest
and exports in this PR. They require an explicit compiler/runtime ABI
migration and conformance decision before a public stable actor ABI.

Every hosted incarnation additionally has an unpredictable 128-bit
`incarnation` value created through `crypto.getRandomValues`.
INIT, DATA and CONTROL carry it; the Worker echoes it on READY, receipts,
STOPPED and terminal PANIC. Mismatching tickets never execute Oreslang
guest code. During an asynchronous MessagePack digest, the Worker
rechecks its closed state immediately before executing its source-level
handler, preventing a replay-induced terminal panic from being followed
by unacknowledged guest execution.

**Scope of guarantee:** one cooperating host JavaScript agent and its
dedicated Worker carriers; **not** shared across browser tabs, host
processes, machines, supervisors, and other execution agents.
The `actorKey` is an identity, not a cryptographic grant.
The `incarnation` token is defense against stale messages, not a
fencing token for databases or network side effects. A future supervisor
must coordinate actor incarnations, enforce one live execution lease
across carriers, and attach nonwrapping fencing epochs to every external
effect before source-level asynchronous actor migration is allowed.

The real-browser gate requires exact, native-LLVM-compiled actor Wasm and
its pinned manifest and will **not** skip either engine:

```sh
npm install --no-save --no-package-lock --ignore-scripts playwright@1.56.1
npx playwright install --with-deps chromium firefox
ORE_REAL_ACTOR_WASM=/absolute/path/counter.wasm \
ORE_REAL_ACTOR_MANIFEST=/absolute/path/counter.wasm.artifact.json \
node scripts/verify-compiled-actor-browser.mjs
```

## Canonical compiled actor INIT and terminal hardening

The bounded canonical `validateActorMessageV2Contract` codec parser is the
single source of truth for both host and Worker INIT validation. Invalid
shape grammar or excessive nesting is rejected before allocating a Worker;
a forged INIT arriving directly in the Worker is checked independently.
After a terminal panic or drain, the endpoint never publishes READY or
acknowledges DATA, and discards owned DATA frames and guest artifact bytes.
An INIT pending asynchronous WebAssembly admission must check its closed
state before running compiler-generated actor initialization.

These guarantees cover a **single JavaScript agent** and its dedicated Worker.
They do not establish cross-tab or distributed actor fencing, arbitrary
async cancellation of CPU-bound Wasm guest code, or Java/GraalVM parity.

## Explicit versioned MessagePack actor artifacts

The MessagePack endpoint retains actor-specific v1 export names. The opt-in
actor-i64-v2 manifest instead requires the fixed init/on_message/teardown
exports and NEW-ACTIVE-STOPPED lifecycle. Manifest version and exports must
agree; no implicit reinterpretation is allowed. V2 cleanup ownership is
revoked before teardown, and initialization checks terminal state at digest,
compile and instance admission boundaries. V1 remains supported without a
teardown export. Synthetic ABI fixtures are host tests only; compiler-generated
v2 guest verification remains a separate required gate.
