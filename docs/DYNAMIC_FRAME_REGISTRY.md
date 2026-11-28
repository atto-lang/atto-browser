# P0 dynamic Oreslang WindowFrameRegistry — implementation and release gates

Status: **real Oreslang source, not yet native-compiled/guest-executed**.
This is NOT the completion of [issue #3](https://github.com/ores-truffle-oreslang/oreslang-web-browser.ores/issues/3):
physical renderer OS processes, authenticated IPC and compositing are absent.

## Files and integration contract

- `src/browser/frame_registry.ores`: a single-window, single-owner,
  **dynamic** array-backed registry of live frames and renderer-process
  identities, with a bounded maximum of **64 simultaneously live frames**
  and **32 active renderer-process records**.
- `src/browser/window_frame_registry_actor.ores`: an Oreslang
  `WindowFrameRegistryActor` wrapping the registry in a sealed
  `state { ... }` and `handle_state(critical |s| -> ...)` transactions.
  Actor method effects use `state.read, state.write`; the IPC protocol
  is deliberately a **trusted local integer fixture**, not actual guest
  renderer messages or Qt FFI.
- `tests/guest/dynamic_frame_registry.ores`: native Oreslang contract
  vectors exercising dynamic allocation, sibling cross-tab renderer
  reuse, multi-level cross-site frames, epoch-correct navigation,
  partial subtree closure, phantom process/actor rejection, process
  crash and new process binding, origin-strict locks, renderer IPC and
  surface pins, and 64 live-frame budget.
- `ci/native-cases.txt`: now **16** exact expected-output pairs. Tests
  are deliberately fail-closed on absent compiler/binary SHA and
  non-executed runner jobs.

## Core invariants / ownership

1. The **window supervisor process** exclusively owns the registry. A
   registry is bound to one `window_id`, `profile_id` and
   `partition_id` assigned by a trusted app-wide ProfileBroker. The
   registry's internal integer arguments are *not capabilities* and
   must not be accepted directly from a renderer process.
2. Renderer admission records an immutable logical `renderer_id`, a
   `renderer_generation`, `site_tenant_id`, owning
   `renderer_actor_id` and optional strict `origin_id` lock.
   Renderer/actor IDs never recycle within the window session.
   **One actor per renderer** is a registry uniqueness requirement,
   but actual actor process/OS handle binding is not wired yet.
3. Each dynamic frame record has a monotonic never-recycled frame ID,
   tab ID, parent ID, renderer ID/generation, site ID, exact origin ID,
   document epoch and liveness. A tab can have many frames and many
   renderers, while a single renderer can serve frames across compatible
   tabs in one window. The parent tree is checked for single root per
   tab and max depth 16, with browser-created positive parent IDs.
4. `commit_navigation` performs a generation-fenced atomic update of
   renderer/site/origin assignment and document epoch, retaining the
   old binding if any prerequisite fails. **Actual network response
   validation and a separate pending-navigation reservation are still
   required** before calling this method in production.
5. `close_subtree` scans descendants from the unchanged live tree,
   then tombstones all matched entries in a **second** phase. This
   avoids a dangerous bug where deleting a parent early would conceal
   grandchildren during the same traversal. Recycled physical array
   slots receive new never-recycled logical frame IDs.
6. Renderer process reference counts are **derived from live frames**,
   not reported by untrusted renderers. Renderer retirement is denied
   while any frame, IPC pin or compositor pin remains, and requires a
   trusted supervisor receipt. In-flight tokens are currently numeric
   counts, **not unique anti-replay tickets**; a production broker must
   replace them with unique closeable claims before accepting untrusted
   renderer traffic.
7. On trusted process death, `crash_process` invalidates ALL live
   frame bindings across tabs that reference that renderer, increments
   their document epochs, retires its logical process ID, and refuses
   stale surfaces/IPC. Restart requires a **new** process and actor ID.
   Profile storage and permissions do not belong to this registry.
8. Origin locks apply to renderer reuse, but sharing the same *site*
   must NOT grant different origins mutual DOM/localStorage/worker
   authority. Exact-origin checks remain at the broker boundary.

## Bounded resource plan and limitations

The implementation uses growable `Array<int>` columns, append/set and
linear scans, capped at 256 total slots for a single window session,
64 live frames and 32 active renderers; it is a **correctness-first
Oreslang prototype**, not a measured or preallocated zero-allocation
hot path. Worst-case close subtree traversal performs repeated parent
searches, and is intentionally bounded by frame count/depth. Runtime
quota enforcement, scheduler cooperation, arena backing, subtree
indexing, and process/IPC timeouts remain missing.

The `WindowFrameRegistryActor` fixture initializes a registry with
window/profile/partition IDs all equal to 1 for deterministic tests.
Production MUST receive broker-issued window/profile context through
authenticated startup, not a hard-coded constructor or renderer command.
Its `FrameRegistryCommand` exposes integer fields and a
`supervisor_receipt=true` test branch; this is NOT safe for hostile
input. Do not wire it to Qt or cross-process traffic as-is.

## Exact acceptance checklist

1. On exact source and compiler SHAs, compile and execute
   `tests/guest/dynamic_frame_registry.ores` and
   `src/browser/window_frame_registry_actor.ores` as actual
   **Oreslang** guests with byte-exact outputs:
   `browser:dynamic-frame-registry-ok` and
   `browser:dynamic-registry-actor-ok`.
2. Run existing 14 native guest cases, plus new 2, on Java/Graal and
   LLVM; check the sealed actor-state borrow/effect rules against
   actual compiler heads. Running source-only `check-source.sh` is
   not native execution evidence.
3. Replace local fixture commands with typed authenticated capability
   messages and linearizable one-to-one renderer actor registry backed
   by real sandboxed OS process handles and real per-renderer IsolateVM.
4. Supply a trusted PSL-aware site resolver, canonical origin and
   exact partition IDs, plus origin-strict/COOP/OAC agent-cluster
   splitting. Browser-grade site locks need actual OS sandbox/broker.
5. Broker cross-site frame navigation, `postMessage` (both sender and
   receiver epochs), mouse/keyboard focus, scoped GPU/compositor
   surfaces, IPC anti-replay, bounded mailbox admission and OS-level
   crash/restart. Keep Qt/QML frontend only.
6. Prove cross-tab renderer survival, two-window process independence,
   native FFI exports, Qt graphics smoke, ASan/UBSan, process budget and
   forced-kill cleanup tests on an actual runner. A failed Actions job
   with zero steps proves none of these.

Upstream dependency: [LLVM issue #1163](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/issues/1163).
