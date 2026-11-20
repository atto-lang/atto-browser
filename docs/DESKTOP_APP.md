# Native desktop browser: UX, isolation and web-platform roadmap

Status: **architecture + Oreslang policy and actor prototypes only**. No
operating-system window, rasterized web page, network stack or JavaScript
engine runs in this repository yet.

## Qt/QML desktop shell and Oreslang FFI contract

**Decision: Qt 6 Quick/QML is the native UI, Oreslang is the sole browser
backend, and a strict C ABI FFI bridges them.** Do not implement the browser
backend in C++, QtWebEngine, or a Node/Python service. The C++ Qt integration
is a thin platform/transport adapter, not a second business logic engine.

See [QT_ORES_FFI.md](QT_ORES_FFI.md) for source files, ABI v1, threading,
test/compile instructions and the missing actual Oreslang exported library.

## No-webview architecture

Browser application logic, permission rules, history, tab strip, notification
broker, service-worker registration and actor supervision belong in **Oreslang**.
The new target is one Oreslang window OS process and one controlling actor
per renderer process, with site-tenant IsolateVMs, plus a separate per-profile
broker for cross-window shared services. See
[WINDOW_RENDERER_SITE_TENANTS.md](WINDOW_RENDERER_SITE_TENANTS.md).
Same-site subdomains do not get same-origin DOM or storage authority.
A **minimal platform adapter** exposes OS primitives but **must not embed
Chromium, CEF, WKWebView, WebView2, Electron or another browser WebView** and
must not implement browser control-plane semantics in JS/Node/Python.

Boundary:

- Oreslang BrowserSupervisor: window/profile/tab registry, typed IPC,
  permissions, canonical URL/origin database, user attention broker.
- Oreslang WindowTabStripActor: current index/focus commands; per-tab
  TabSessionActor: bounded history ordering. These are proof-of-concept
  index/session models; stable tab handles and URL history are future work.
- Sandboxed renderer worker processes: site-tenant locked IsolateVM, one
  controlling RendererSupervisorActor per worker, and separate per-origin JS
  realms plus exact-origin storage/permission broker checks.
  High-risk, independently controlled subdomains and incompatible context
  groups force separate renderers. At present **not built**.
- Narrow OS adapters:
  - macOS: native Cocoa/Metal window and compositor surfaces; OS notification
    APIs; accessibility and keychain primitives.
  - Windows: Win32/Windows App SDK window + D3D compositor, OS notification
    APIs, accessibility and credential primitives.
  - Linux: Wayland (X11 fallback) native window + GPU/compositor, desktop
    notification portals, accessibility and secret storage.
  - Safe Rust for OS wrappers is acceptable; it must expose a narrow FFI and
    not become a second browser implementation. C++ native host applies to
    OresVM/IsolateVM itself.
- GPU and network brokers are privileged, separate from untrusted renderer;
  no direct renderer filesystem, device, clipboard or raw socket access.

## Native shell UX contract

1. Window: multi-tab strip, Ctrl/Cmd+T new, Ctrl/Cmd+W close,
   Ctrl+Tab next, Ctrl+Shift+Tab previous; multi-window support.
2. Address/search bar: canonical verified URL display, address origin and
   certificate/site-info indicator owned by privileged chrome, not webpage.
3. Navigation: back/forward, reload/stop, page loading/crash/permission
   indicators; history and restore are profile-scoped, never written in
   private sessions.
4. Profiles/containers: visibly separate tenant profile icons and tab colors;
   tab drag/move only within matching tenant/profile/private mode;
   temporary guest containers, workspace groups, pinned tabs, split view.
5. Side panels: per-origin notification inbox, site permissions,
   storage/worker diagnostics, downloads, accessibility controls,
   keyboard-first command palette.
6. Native compositor surfaces: frame trees can cross renderer processes;
   browser chrome and security prompts cannot be forged by page painting.
7. Responsive rendering: per-tab frame budget and page suspension; background
   tabs throttle CPU but active service-worker event delivery can wake a
   separately limited worker. Keep the window responsive if renderer crashes.

The initial WindowTabStripActor uses *presentation indices* only and caps
at 64 open slots. A real TabRegistry must use opaque generation-fenced IDs
and atomically remap indices after close/move, without recycling authority.

## Notification UX and policy

- User-gesture-only permission prompt from the focused secure top-level
  origin (no navigation-time prompt; block abused prompts).
- Explicit site permission + OS permission, per-site mute,
  focus/DND/quiet hours, notification rate budget and digest grouping.
- Privileged notification inbox, persistent-site notification controls,
  one-click revoke/block; clear origin data unregisters associated push.
- Persistent notifications require authorized active service-worker
  registration and exact profile/storage partition. Page notifications
  are tied to page lifetime. OS push endpoints are sensitive capabilities.
- Action/click requires trusted OS dispatch and one-time generation-fenced
  ticket; the broker must atomically consume the token. Private profiles
  default to no notification prompts/background display.
- The initial functions only make *stateless decisions*. State, rate
  counters, OS permission checks, ticket consumption and visual delivery
  are still unimplemented; no current notification can be displayed.

Standards: https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API ,
https://developer.mozilla.org/en-US/docs/Web/API/Push_API .

## Service workers: compatibility + stronger security

- Registrations keyed by (profile/tenant, partition/top-level site,
  canonical owner origin, normalized scope). Scope path matching and
  origin calculation must be performed by trusted canonical URL parser.
- WorkerRegistrationActor holds a fixture-level registration, active and
  staged-waiting flags, runtime sleeping/waking and version promotion.
  Real worker registration maps, update scripts, durable cache, fetch
  interception and JS execution are **not implemented**.
- Keep active vN while vN+1 waits; activation after old clients drain,
  or support explicit spec-compatible skipWaiting()/clients.claim().
  Atomically switch the active worker, do not discard vN before commit.
- Worker event lifetimes are bounded, no permanently running daemon
  default, and terminated workers may restart for eligible queued
  events. Add navigation preload, background sync and offline cache
  when the necessary fetch/cache/runtime infrastructure exists.
- Per-registration quotas: script+cache storage, CPU and time/event
  budgets, memory, queued fetch/push jobs, update rate. Fail closed on
  generation mismatch, scope/partition mismatch, revoked registration.
- Push subscriptions/keys stored encrypted in profile partition and
  never logged. Bind push subscriptions to the registration epoch (stable
  across worker script updates), not to each active script version. Site-data deletion invalidates subscriptions and queued
  events. Private session data cannot survive closing its session.
- Worker fetch routing compares the *controlled client origin* with the
  registration, not the remote resource URL: a valid service worker can
  intercept fetches to cross-origin resources subject to usual web
  security controls. Never authorize a worker based solely on the
  resource hostname.
- Need browser-enforced SOP, Fetch/CORS, CSP, cookie isolation, opaque
  response blocking and permission mediation even if a renderer is
  compromised. Policy-only checks cannot provide this yet.

Standards: https://www.w3.org/TR/service-workers/ and
https://developer.mozilla.org/en-US/docs/Web/Privacy/Guides/State_Partitioning .

## Security release gates

1. Host-issued canonical origin/tenant/storage partition IDs with
   typed immutable handles, generation fencing and replay-proof IPC.
2. A real out-of-process sandbox for every untrusted renderer/worker;
   verified OS restrictions, no ambient native host syscalls, crash
   and lifecycle containment. In-process LLVM IsolateVM alone is NOT
   sufficient.
3. File/socket/clipboard/media/permission brokers, cross-origin
   frame surfaces, GPU broker, request/response isolation.
4. Device, phishing, malware and credential protection, passkeys and
   secure updater, reproducible/signed builds, locked extension model.
5. Parse/render web platform through independently reviewed HTML/CSS
   implementations and a compatibility-grade JS engine. No 'working
   browser' claim without actually loading and rendering test pages.
6. Java/Graal and LLVM exact guest execution first, then .wasm/.net/.forge
   source parity and OS integration. Include ASan/UBSan, sandbox bypass,
   cross-tenant storage leak, process-crash and notification/push replay.
7. A real native desktop window, interactive tab strip, address bar and
   verified pixel output on at least one desktop OS.

All IDs, `sandbox_verified`, `secure_context`, `user_activation`,
`verified_os_click` and `scope_path_matches` in current policy functions
are **trusted-host inputs**. Supplying a true value from renderer JS cannot
grant authority. No authenticated host capability service yet exists.
