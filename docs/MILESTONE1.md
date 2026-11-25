# Milestone 1: Oreslang desktop browser control plane

Status: **PARTIAL IMPLEMENTATION; NOT COMPILED, NOT CONNECTED TO QT**.

## Source now available

- `src/browser/browser_supervisor.ores`: native Oreslang `BrowserSupervisorActor`, one `state` schema and a single `handle_state(critical ...)` transaction per command. A fixture exercises two slots, independent monotonic IDs, select/close, rejecting stale IDs, monotonic revisions, and separate actor instances. **Two tabs only**; fixture integer commands are neither the full C ABI nor authenticated IPC.
- `src/browser/tab_epoch.ores`: actor epoch state under critical write loan.
- `src/browser/renderer_supervisor.ores`: renderer lifecycle state and generation under a critical write loan. No OS process launching.
- `src/desktop/window_tab_strip.ores`: presentation selection and count in one actor state schema. Its indices are NOT FFI tab IDs.
- `src/desktop/tab_session.ores`: per-tab history counters in a critical actor transaction. URL/history list and snapshots not built.
- `src/workers/lifecycle.ores`: worker staging/activation state in a critical actor transaction. No real JS worker.
- `ci/native-cases.txt` and `ci/verify-native.sh`: **fourteen** source/expected-output pairs. `ci/check-source.sh` performs structural state-presence and direct-field-access checks.

## Boundary truth

Qt/QML is the privileged presentation frontend, not a second backend. Oreslang
must own user-intent dispatch, tab state, navigation, permissions, site policy,
notification and worker lifecycle. Native C/C++ may marshal fixed ABI records
and invoke OS primitives; it must not synthesize browser semantics.

This branch still **does not export** any of
`ores_browser_abi_version`, `ores_browser_open`,
`ores_browser_dispatch`, `ores_browser_snapshot`,
`ores_browser_close` from a real compiled Oreslang module.
The Qt shell correctly fails closed without those exports. No real websites,
renderers, browser sandbox, compositor, network, or native notification service
have been implemented.

The first Oreslang actor-control slice is intentionally capped at **two**
tabs to prove state transition semantics before expanding to a bounded
64-tab registry with generation-fenced identities. Do not wire its local
integer fixture protocol to the privileged Qt UI.

## Test contract

1. `sh ci/check-source.sh`: structural check only; neither compiler nor runtime evidence.
2. `sh ci/check-qt-ffi.sh`: compiled and executable host C/C++ ABI and
   adversarial wire checks when a runner actually executes its steps.
   Does not prove a working Qt GUI or Oreslang actor.
3. `sh ci/verify-native.sh`: requires a pinned native Oreslang compiler,
   clean exact Git head, real `--check` and execution with byte-exact
   output on all twelve fixtures. Never substitute a shell/Node/Python simulator.
4. `ci/verify-backend-ffi.sh` requires an absolute app-owned native shared
   library path, independently pinned `ORES_BROWSER_BACKEND_SHA256`, exact
   `EXPECTED_SOURCE_SHA`, and a clean checkout. It compiles and runs
   `tests/abi/backend_integration.c` against the **real exported symbols**:
   opens a fresh session, creates two tabs, selects and closes a tab, rejects
   a stale handle without mutating state, and checks bounded canonical
   snapshots and revision consistency. The static source audit compiles this
   probe but does **not** run it with a fake backend. The probe has NOT
   passed because the compiled Oreslang backend does not exist yet.
5. A real Qt 6.5+ GUI build and desktop smoke must prove two tabs with live
   backend receipts, stale command denial and clean bounded shutdown.
6. Sandboxed renderer subprocesses require OS-level isolation, brokered
   authenticated bounded IPC, collision-proof generation fencing, crash tests
   and resource quotas. An in-process IsolateVM is not a secure process.

No native Oreslang execution of the new state syntax was available at
authoring time. `state`, `handle_state` and `critical` must be checked
against the **exact targeted compiler head**, including effect declaration,
loan lifetime, and no suspension inside a write loan. Do not claim semantic
enforcement based on source spelling.

## Exact-tree private CI handoff (approval not granted)

The source org's GitHub Actions jobs still fail **before recorded steps**
(`runner_id=0`). A **source-free** runner canary in the private
`usa-acc/usa-acc-e2e` repository completed successfully with an actual
runner and three executed steps:
[run #40935013310](https://github.com/usa-acc/usa-acc-e2e/actions/runs/40935013310).

The source is private, and a successful canary does NOT grant permission
to transfer it. [Security approval issue #4](https://github.com/ores-truffle-oreslang/oreslang-web-browser.ores/issues/4)
requires a destination-specific independent reviewer, immutable source
tree pin, approved retention/access controls and protected review gates.
**No browser source was transferred to the candidate organization.**

A new `ci/verify-mirror-identity.sh` checks the carrier checkout SHA,
the independently supplied source Git tree SHA, all tracked path/mode/blob
identities implied by that tree, and an entirely clean working tree.
It deliberately reports identity only—not transfer authorization, budget,
compiler execution, or code correctness. The hermetic
`tests/ci/test-mirror-identity.sh` creates **synthetic test repositories**
and rejects wrong commits, wrong trees, invalid pins, dirty files and a
file-mode-only change. It also accepts a mirror commit whose hash differs
from the source commit while retaining the exact source tree.

These scripts were checked as POSIX shell and executed locally
with positive and negative test paths; their Git blob hashes were read
back from the committed branch and compared. This is independent of
native Oreslang compiler/Qt execution.

## Remaining hard dependencies

- Upstream LLVM compiler contract: [oreslang-source.llvm issue #1163](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/issues/1163).
- Migrate these first slices to the compiler-accepted sealed critical state
  contract and verify Java/Graal + LLVM conformance. Resolve any syntax
  mismatch without weakening state encapsulation.
- Replace fixed slots with a real 64-tab actor-owned registry, stable
  `(window, profile, tab_id, generation)` keys, revisioned snapshots and
  typed, bounded command receipts.
- Produce an AOT shared library whose symbols actually enter Oreslang actor
  turns, then a Qt two-tab integration smoke with an exit status.
- Verify OS signing, safe library/dependency loading, sandboxed per-site
  subprocesses and profile broker identity before accepting untrusted HTML.

Release gate: **keep PR #1 in draft** until all source/build/security tests
have real executed evidence rather than zero-step runner failures.

## Follow-on: multi-renderer tabs / frame registry slice

The new `src/browser/frame_routing_policy.ores` and
`tests/guest/frame_routing_policy.ores` define 48 positive/negative
frame routing policy vectors. The new
`src/browser/window_frame_graph.ores` sealed-state actor
is a two-tab, three-frame, two-renderer fixture showing cross-site OOPIF
assignment, renderer reuse across tabs, atomic same-site navigation
rebinding, stale surface fencing, derived renderer reference counts,
subtree close and independent window actor state. These local integer
commands do NOT constitute a general-purpose dynamic frame tree.

See [MULTI_RENDERER_TABS.md](MULTI_RENDERER_TABS.md). Native compilation,
real OOPIF OS processes, renderer IsolateVM, IPC and compositor remain
unverified/unimplemented. Total manifest count is **14**; a zero-step
CI run must not be called a passed test.

## Dynamic WindowFrameRegistryActor milestone (new PR)

The fixed two-tab/three-frame actor example is retained as a minimal
cross-site OOPIF fixture. A new dynamic array-backed Oreslang
`frame_registry.Registry` with Oreslang `WindowFrameRegistryActor` wrapper
adds bounded live-frame admission (64), renderer/actor uniqueness, parent
checks, epoch-fenced navigation, two-phase subtree deletion, renderer
reference counts, drain pins and crash/rebind semantics. The new native
guest manifest includes **16** acceptance programs. The module is
allocation-backed and O(n) or worse on operations; no preallocated
arena, authenticated IPC, process launcher or compositor yet.
See [DYNAMIC_FRAME_REGISTRY.md](DYNAMIC_FRAME_REGISTRY.md).

## Combined native prototype gate

The session lifecycle actor from #30 is preserved with the native registry work, not enabled by the Qt host integration. The combined manifest requires 17 exact-source cases; actual native compiler execution and backend integration remain separate outstanding gates.
