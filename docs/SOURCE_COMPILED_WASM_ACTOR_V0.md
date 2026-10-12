# Source-compiled actor execution in a real Browser Worker (v0)

This experimental, **separate** Worker endpoint executes actual
`oreslang-llvmc --target=wasm32` output, not a synthetic IR stand-in.
The source compiler implementation is LLVM PR #238. This Browser integration
is carried by Browser PR #9 and may not be used as a production actor runtime.

## ABI

One module Worker exclusively owns one Wasm module instance with its
compiler-generated guest exports:

- `oreslang_wasm_actor_init()`
- `oreslang_wasm_actor_on_message(i64) -> i64`
- `oreslang_wasm_actor_teardown()`

The Worker accepts `oreslang-v2-source-init` with exact SHA-256-pinned
Wasm bytes, a canonical MessagePack schema, and the scalar `I` descriptor.
It admits no SharedArrayBuffer, requires no Wasm imports, rejects start
sections and unbounded memory, and limits the module to 1 MiB and its
linear-memory maximum to two 64-KiB pages.

After successfully initializing the compiled actor, each
`oreslang-v2-data` ticket decodes a canonical, owned MessagePack v2
signed i64, executes exactly one synchronous guest handler, and returns
`oreslang-v2-receipt` including the handler result. Ticket IDs must
increase; duplicates, invalid frames, and concurrent message admission
trigger supervisor-facing terminal `oreslang-v2-panic`. The Worker wipes
its own cloned frame buffers and rejects success receipts after panic.
`oreslang-v2-control` drain calls the generated guest teardown and
emits `oreslang-v2-stopped`.

The compiler-generated guest lifecycle is also enforced **inside Wasm**:
NEW -> ACTIVE -> STOPPED, with explicit Wasm traps on invalid calls.
Separate instances have separate actor-owned globals.

## Reproduction

The exact-source CI for this vertical slice:

https://github.com/zed-pkg-test/java-app/actions/runs/38210355908

verifies the complete LLVM and Browser Git trees, builds the actual
`oreslang-llvmc`, compiles
`tests/fixtures/wasm32-single-source-actor.ores`, links it with Clang
wasm32 into a bounded no-import artifact, installs real Chromium and
Firefox through pinned Playwright, then runs:

```sh
ORESLANG_SOURCE_ACTOR_WASM_BINARY=build/source-counter.wasm \
  node scripts/verify-source-compiled-actor-browser.mjs
```

Both engines require 100 accepted and executed typed messages, an
actor-owned counter of 100, successful drain and teardown, zero unexpected
panics, and SHA-256 refusal of a corrupted artifact identity. The input
binary **must exist**; the test never substitutes a C runtime or stub.

## Limits and security contract

This is **not** source-level `spawn`/`ActorRef` lowering, reader/writer
actor locks, a native OresVM scheduler, Java/LLVM behavioral parity,
cross-worker transfer of arbitrary owned heap objects, reentrant
continuations, supervision hierarchy, automatic source `tear_down()`,
`on_throw()`/`on_raise()`, guest panic routing, or a malicious-code
sandbox. The guest supports only one synchronous scalar actor per module;
a browser Worker must be treated as the sole execution owner of its guest
instance. The host must enforce its own deadline and cancellation to avoid
untrusted code monopolizing that Worker. Full lifecycle and CONTROL-plane
verification remains a separate release gate.
