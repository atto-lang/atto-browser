# PR #5 — verified browser Worker semantic reconciliation

Historical head `21ddce6354eaad36794d3943d9061fd678d6e63f`; current main `66631f383120fcd23dfd0165eb9786b15d5c3124`.

Current main already implements the historical dedicated single-shot module Worker and SHA-256/zero-import/bounded-memory scalar Wasm admission. It adds newer mandatory features: cancellation-safe AbortSignal handling, exact manifest snapshots, strict error/result handling, real-engine test plans and prompt cleanup. Do not overwrite current `src/worker-host.mjs`, `guest-worker.mjs` or browser test harness with the historical implementations.

Forward-port a new adversarial, source-free Node test exercising the race where a trusted `workerFactory` synchronously aborts during construction. The Worker must not receive guest bytes, must be terminated once, and must release its event listeners. This is a **host callback race**, not production browser execution or an actor-runtime implementation. The existing real Node Worker tests and browser-engine suite remain authoritative.

Release gate: run `node --test tests/worker-host-race-forward-port.test.mjs`, the full Node suite and Chromium/Firefox dedicated Worker suites on the exact head; do not treat a synthetic Wasm fixture as compiled Oreslang guest parity.
