# Oreslang backend ↔ Qt 6 / QML desktop FFI contract

## Mandatory architecture

**Oreslang is the browser backend. Qt 6 Quick/QML is a privileged presentation shell only.**
Qt hosts native windows, accessibility, the address bar, toolbar, tab-strip
visuals, keyboard shortcuts and a future compositor surface. **Qt does not
host the website rendering engine, network stack, origin policy, permission
database, notification scheduler, or service-worker coordinator.**

```text
Qt Quick / QML chrome (main GUI thread; no web-engine component)
        |
        | Q_INVOKABLE user-intent commands; snapshot-only properties
        v
UiBridge(QObject) -- queued invocations / signals, no browser logic
        |
        v
BackendWorker (dedicated Qt worker QThread)
        |
        | versioned C ABI v1 (fixed-size value structs, no shared pointers)
        v
libores_browser_backend  [REQUIRED, NOT YET IMPLEMENTED]
        |
        v
Compiled native Oreslang BrowserSupervisor actor
        |-- Oreslang WindowTabStripActor, TabSessionActor
        |-- Oreslang origin/profile/tenant/permission policy
        |-- Oreslang service-worker + notification supervision
        |-- sandbox process / renderer / graphics brokers [NOT IMPLEMENTED]
```

The C++ files `desktop/qt/UiBridge.{h,cpp}` are *transport adapter only*.
They never choose tab state, navigation history, tenant, website origin,
OS notification permission or worker lifecycle. QML is permitted lightweight
display logic and binding expression/keyboard gesture routing; browsing
decisions and even the next/previous-tab transition are commands to Oreslang.

The UI must not directly call an untrusted web renderer. Browser chrome is
in the privileged Qt process and compositor content is a distinct untrusted
surface. Site content must not draw permission UI or spoof the address bar.

## Runtime ABI

`include/ores_browser_ui_abi_v1.h` defines the C ABI. Implementors must
export these five symbols from **AOT-compiled Oreslang-owned code or a
minimal host-export layer dispatching directly into actual Oreslang actor
code**:

- `ores_browser_abi_version`
- `ores_browser_open`
- `ores_browser_dispatch`
- `ores_browser_snapshot`
- `ores_browser_close`

No C++ replica of tab history, permissions, notifications, service-worker
state, or a fake backend is allowed in production. A compiler/runtime
integration PR must prove each operation enters the real Oreslang
BrowserSupervisor source and that callback completion/rejection is handled.

`OresBrowserCommand` is an intent packet. All tab IDs and generations
originate from the backend snapshot. UI IDs are passed as decimal strings
to avoid JavaScript's 53-bit integer limitation. The backend is responsible
for **authorizing** every command, not trusting Qt's UI checks. `NEW_TAB`
has no selected tab identity; `SELECT_TAB`, `CLOSE_TAB`, `NAVIGATE`,
`BACK`, `FORWARD`, `RELOAD`, `NEXT_TAB` and `PREVIOUS_TAB` require
generation-fenced tab identities. Backend canonicalizes navigation URLs.

`OresBrowserSnapshot` is backend-owned state copied as bounded value data:
at most 64 tabs, title 159 UTF-8 bytes plus NUL, URL 2047 UTF-8 bytes plus
NUL, revision monotonic, one selected tab when nonempty, bool fields 0/1,
reserved fields zero. All C ABI structs carry version/size where applicable.
The UI rejects malformed values; no Oreslang heap pointers, Qt objects or
cross-language allocators appear in structs. Future larger snapshots should
introduce ABI v2, not silently break v1.

### Threading and shutdown

- The GUI thread **never calls the Oreslang C ABI directly**.
- `BackendWorker` loads the native app-bundled library and runs all ABI
  calls on a single dedicated thread; future actor events may wake it via
  a bounded event queue rather than polling.
- `UiBridge` uses queued invocations and Qt signals. It is a read-only
  projection of an Oreslang snapshot, not a second mutable browser model.
- The current 250ms snapshot polling is a **bootstrap convenience**, not
  an efficient production event protocol. Backpressure, deadlines,
  cancellation and out-of-process broker notifications remain required.
- Production actor/FFI shutdown must have bounded durations and error
  receipts; the current synchronous worker teardown is not yet hardened
  against a permanently stalled foreign library.

### Runtime startup and security

The Qt bridge loads `ores_browser_backend` from the application's own
directory through Qt's `QLibrary`, resolves the five required exports,
checks ABI v1, and opens an Oreslang session. If any step fails it **fails
closed**: UI remains visible but every tab/navigation operation is disabled.
There is **no Node, Python, WebEngine, Electron or C++ fallback backend**.

Release packaging MUST code-sign / attest the bundled native library and
validate origin & path under each OS trust model. File location and a version
number alone are not proof of authenticity.

The backend must select the user's authorized profile/tenant. Config does
not accept UI-provided tenant IDs. There is no working tenant authentication,
secure startup IPC or sandbox in this slice.

## Build and run the Qt presentation shell

Requirements: CMake 3.21+, C++17, Qt 6.5+ (Quick, Qml, QuickControls2).
Actual Qt configuration, compilation and GUI launch are **NOT VERIFIED**
in the present environment; Qt 6 Quick libraries are not installed there.

```sh
# From repository root:
sh ci/check-qt-ffi.sh    # C/C++ header and source shape checks only

cmake -S desktop/qt -B build/qt -DCMAKE_BUILD_TYPE=Debug
cmake --build build/qt --parallel
./build/qt/ores-browser
```

Until `libores_browser_backend` is built and deployed alongside the app,
this launches at most a native **offline Qt chrome**; it cannot open
working webpages. The UI explicitly says renderer integration is missing,
even when a future backend establishes a tab session.

## Required upstream compiler milestone

The Oreslang LLVM backend demonstrates compilation of native source actors
to a C/C++ linked host adapter, but this does not guarantee a stable
exportable C ABI for the *full async browser actor supervisor*. Build and
verify a versioned AOT export adapter that initializes OresVM, spawns the
BrowserSupervisor actor, marshals bounded commands, awaits acknowledgments
without parking UI threads, snapshots state atomically, and drains actor
resources at close. It must pass C and C++ ABI conformance, nested/multiple
tenant admission, stale ID and cancellation tests at exact compiler SHAs.
Future JVM/Graal Native Image, .net and .wasm adapters must implement the
**same behavior**, not a separate source of truth.

## Next UI/runtime milestones

1. Backend actor exported ABI with real two-tab create/select/close state,
   monotonic revisions, and compiled integration tests through the Qt
   bridge. The existing Oreslang tab-strip actor currently uses presentation
   indices, so it needs stable generation-fenced IDs before ABI exposure.
2. Qt GUI build + smoke on macOS, Windows, Linux; accessibility, native
   menus, window restore, multiwindow focus, keyboard shortcuts.
3. Renderer OS sandbox / brokered IPC and native compositor surface
   (with zero website WebViews). Tab renderer crash and tenant cleanup tests.
4. Notification center and service-worker manager QML panels backed by
   Oreslang actors and capability-authenticated OS adapters.
5. Network/HTML/CSS/DOM/JS execution in tenant-scoped renderer IsolateVMs.

References:
- Qt: https://doc.qt.io/qt-6/qtqml-modules-cmake-integration.html
- Qt: https://doc.qt.io/qt-6/qtqml-cppintegration-exposecppattributes.html
- Qt: https://doc.qt.io/qt-6/qquickwindow.html
