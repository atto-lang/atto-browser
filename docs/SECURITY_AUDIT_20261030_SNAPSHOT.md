# Browser Qt event-queue backpressure audit — 2026-10-30

## Finding: unbounded worker-to-UI snapshot notifications

**Severity: High availability risk (UI-event-loop exhaustion), not a
renderer sandbox escape.** The native Qt bridge kept a 250-ms timer and
emitted a full `QVariantList` of up to 64 tab records after each changed
Oreslang snapshot. While the Qt UI event loop was blocked, a functioning
backend could continue enqueueing revision-bearing `ready()` events
without any credit limit. The existing command limiter in PR #9 governs
**UI -> FFI commands only**, not this reverse direction.

## Implemented mitigation (stacked on draft PR #9)

- `OresBrowserSnapshotQueueV1` is worker-thread-owned; it admits
  **one nonzero snapshot revision at a time**.
- `BackendWorker::readSnapshot` skips polling/conversion while a
  snapshot is in flight. It reserves credit **before** emitting `ready`.
- The UI consumes and renders the immutable snapshot and then enqueues
  a revision-matched ACK on the worker's Qt event loop.
- The worker rejects a wrong, duplicate or zero ACK; on a valid ACK it
  immediately reads the latest browser state. Intermediate revisions
  are **coalesced** in the UI: authoritative actor revisions and state
  remain unchanged.
- Shutdown resets credit and ignores late ACKs to the closed backend.
  The guard is not shared across threads, avoiding unprotected counters.
- `ci/check-qt-ffi.sh` compiles and executes a new portable C++17
  test: 100,000 failed reservations while a snapshot is outstanding,
  wrong-revision ACK denial, duplicate ACK denial, recovery, 1,024
  additional fill/drain cycles, maximum revision and shutdown reset.

## Scope and evidence

The portable snapshot-gate test was independently compiled on exact
Git blob contents:

- Header blob: `68bb2203206eb6906df57fce027b07fd487dee62`
- C++ test blob: `5ad8a3d4dbf1802e1fea5160b6e5759bd0d01111`

GCC 14 C++17 `-Wall -Wextra -Werror -pedantic` and GCC 14
ASan+UBSan `-O1 -fsanitize=address,undefined` **passed locally**.
This is **not** evidence of a Qt event-loop test, browser process
sandbox, real compiled Oreslang guest, linked browser AOT FFI, or
successful GitHub Actions steps.

## Required release verification

1. Execute a real Qt 6 test with a deliberately blocked UI thread,
   rapidly changing backend revisions and an observed bounded queued
   signal count; verify the latest snapshot is eventually delivered.
2. Validate wrong, stale and replay ACK handling under process closure,
   Qt teardown and worker fatal/shutdown sequencing.
3. Run exact-head native Oreslang compiler plus backend ABI integration
   from `ci/verify-backend-ffi.sh` with independent library provenance.
4. Prove actual OS renderer sandbox, canonical URL/origin broker,
   authenticated IPC, process generation fencing, per-site storage
   isolation, crash recovery and resource limits.
5. Obtain executed CI job steps, independent review and protected
   branch gates; do not count zero-step admissions as tests.

**Release: HOLD / DRAFT.** No private-source cross-org transfer is
authorized by this patch. No claim of a functioning web browser.
