# Oreslang Web Browser

**Oreslang-first, actor-native browser prototype** with planned per-window
Oreslang processes, per-renderer actors and schemeful-site tenant isolates.
Current origin-locked policy remains a stricter bootstrap gate. This new repository is NOT YET a
working browser or OS security sandbox.

## Window / site-tenant renderer model (design updated)

**Target:** one Oreslang window-control OS process per desktop window,
one **RendererSupervisorActor per sandboxed renderer OS process**, and
one site-scoped IsolateVM per (window, profile, partition, schemeful
registrable domain) as the usual placement target. For example,
`www.example.com` and `api.example.com` may share the
`https://example.com` site tenant, **not the same web origin**.
Qt/QML is still strictly presentation/FFI. Profile-wide permissions,
storage, notifications and worker lifetime require a separate trusted
profile broker shared across windows.

Security exceptions may require *multiple* renderer/IsolateVM instances
for a site (independently-controlled subdomain hosting, COOP/OAC,
cross-origin-isolated contexts, browsing-context constraints, quotas).
All DOM/storage/service-worker access remains exact-origin/partition
checked. Existing origin-per-renderer predicates stay strict until
the genuine window registry, PSL/URL canonicalizer, and sandbox
integration exist. **This does not yet run a renderer or a second window.**

New Oreslang sources: `src/isolation/site_tenant_policy.ores`,
`src/browser/renderer_supervisor.ores`, and
`tests/guest/site_tenant_policy.ores`. Read the complete
[window/renderers/site-tenant architecture](docs/WINDOW_RENDERER_SITE_TENANTS.md).

## Implemented in this initial branch

- Native Oreslang pure admission gates in src/isolation/policy.ores:
  tenant+origin renderer reuse, same-origin DOM checks, targeted cross-origin
  messaging, generation/epoch-fenced renderer IPC and navigation commits.
- Native Oreslang TabEpochActor in src/browser/tab_epoch.ores with monotonic
  accepted epochs and duplicate/stale rejection.
- Native Oreslang guest policy fixture in tests/guest/isolation_policy.ores.
- Static source audit workflow and a manual, fail-closed native acceptance
  runner. There is no JS/Node/Python browser logic or fallback simulator.

### Verification

Run the static audit (NOT a compiler test):

    sh ci/check-source.sh

Run actual Oreslang guests against an independently trusted compiler build:

    ORESLANG_BIN=/absolute/path/to/oreslang-compiler \
    ORESLANG_COMPILER_SHA256=<64-hex-verified-compiler-digest> \
    EXPECTED_SOURCE_SHA="$(git rev-parse HEAD)" \
    sh ci/verify-native.sh

The native runner refuses to claim success without compiler provenance,
an executable compiler, clean exact checkout, source checks and byte-for-byte
execution results. At PR creation no genuine native execution has been
demonstrated; compiler runs must be recorded separately.

## Qt 6/QML UI + Oreslang FFI — desktop architecture enforced

The desktop **UI is Qt 6 Quick/QML** in `desktop/qt/` and the
**browser backend is Oreslang**. `UiBridge` only transfers commands and
immutable snapshots across a versioned C FFI interface. There is **no
production C++ browser backend and no WebEngine/WebView fallback**.

`include/ores_browser_ui_abi_v1.h` specifies the required exports from
a future Oreslang AOT backend library; `src/desktop/ui_dispatch_policy.ores`
is the Oreslang-side FFI command admission policy. The Qt shell is offline
if the actual backend library is absent or ABI incompatible. Until the
native Oreslang browser supervisor is linked and a renderer exists,
**the app does not browse websites**.

See [Qt ↔ Oreslang FFI architecture](docs/QT_ORES_FFI.md) for ABI,
threading, trusted library loading, build commands, missing gates and
current status.

## Native desktop tabs, notifications, and workers — second slice

- `src/desktop/window_tab_strip.ores`: bounded actor-owned tab strip
  index/focus model (new, next, previous, close, quit).
- `src/desktop/tab_session.ores`: per-tab actor history with
  back/forward and navigation resetting the forward chain.
- `src/desktop/tab_policy.ores`: profile/tenant/private-mode opening,
  focus, restore and safe tab movement.
- `src/notifications/notification_policy.ores`: explicit permission
  prompts, native OS delivery gates, per-site spam limits, DND,
  private-mode protection and replay-fenced notification click routing.
- `src/workers/service_worker_policy.ores`: partitioned registration,
  scoped fetch, staged activation, bounded wake/push admission.
- `src/workers/lifecycle.ores`: service-worker registration actor
  demonstration, including waiting updates and idle restarts.
- Native guest manifest now has **eleven** Oreslang sources, gated by
  a compiler SHA pin. Compilation and real execution remain unverified.

The desktop implementation will be a **native app, not Electron or
an embedded WebView**. OS-only platform adapters may be written in
Rust/C++ while all browser control-plane behavior stays in Oreslang.
See [desktop architecture and security gates](docs/DESKTOP_APP.md).
An actual platform window or website renderer is **not yet implemented**.

## Next milestones

Trusted BrowserSupervisor and canonical URL/origin assignment; OS-sandboxed
renderer workers using OresVM/IsolateVM; typed capability/IPC messages;
navigation and cross-origin iframe coordination; network/TLS, HTML/CSS/DOM,
compositor and JavaScript realms. See docs/ARCHITECTURE.md for the threat
model, contract and order. **Nothing here loads web pages or executes untrusted
website JavaScript yet.**
