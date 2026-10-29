# Browser architecture and security gates

## Accepted placement target (one window process / one actor per renderer)

See [WINDOW_RENDERER_SITE_TENANTS.md](WINDOW_RENDERER_SITE_TENANTS.md)
for the complete authoritative decision. The target uses one Oreslang
WindowSupervisor OS process per window, one RendererSupervisorActor per
sandboxed renderer OS process, and a site-locked IsolateVM per
(window, profile, storage partition, schemeful registrable domain)
where compatible. A separate ProfileBroker owns cross-window authority.

- A "www" host identifies one entry origin for a schemeful-site tenant
  (for example `https://www.example.com` belongs to `https://example.com`).
- Subdomains MAY share the site-locked process/IsolateVM, but must retain
  distinct DOM, cookie/storage, service worker and capability checks as
  appropriate for their **exact origins**. No same-site shortcut for
  privileged origin access.
- Customer-controlled hosting, explicit origin isolation, opaque origins
  and agent-cluster/COOP/OAC requirements force separate renderer/IsolateVM
  placement where needed. Cross-site frames use separate renderers.
- `src/isolation/policy.ores` still implements the earlier, **stricter**
  origin-locked bootstrap predicate. It must not be silently replaced
  by site-tenant placement without real broker and process enforcement.
- `src/isolation/site_tenant_policy.ores` and
  `src/browser/renderer_supervisor.ores` are new Oreslang policy and
  actor prototypes. None launches OS processes or implements real IsolateVM.

## Boundary and identity rules

- The trusted profile broker assigns `profile_id`,
  `site_tenant_id`, `origin_id`, `storage_partition_id`, `window_id`,
  and generation-fenced renderer/process actor IDs; sites are resolved
  with a trusted Public Suffix List and canonical URL parser.
- A trusted browser service must issue positive opaque IDs for canonical
  origins, tenant profiles, tabs, document epochs and renderer generations.
  The positive integer arguments in v0 are fixture inputs, NOT validated URLs,
  signed tickets or authority. Renderer-reported sandbox_verified is NEVER
  trusted; that flag must be obtained from a privileged OS launcher.
- Enforce correct URL/origin parsing, redirects, IDN, default ports, public
  suffixes, opaque/data/file/blob/about:blank/srcdoc origins, storage
  partitions and browser/extension worlds before opening external content.
- Reused renderers require matching tenant/origin, positive generation,
  liveness and *verified OS sandbox*. Generation+document epoch must match
  on every renderer IPC operation, including cross-process frame messaging.
- Same-origin DOM access is denied to a cross-origin document. Cross-origin
  postMessage may be delivered *within a tenant* only when the sender targets
  the exact browser-resolved receiver origin and active document epoch.
  Wildcard targets are disallowed in v0.
- Browser-issued navigation tokens must match the active pending epoch and
  tab/tenant; cancellation, tabs closing, crashes and stale responses revoke
  prior authority. Recycled PIDs never confer identity.
- No ambient filesystem, shell, clipboard, GPU, camera, microphone or network
  access from an untrusted renderer. Brokered IPC needs typed, versioned and
  length-bounded messages and authenticated actor/tenant/renderer identities.
- Quotas must cover renderer process count, tenant memory/RSS, actors, CPU,
  mailbox backlog, recursion, storage and network. Resource retirement and
  crash cleanup must be generation-fenced, zeroed or ownership-safe.

V8 isolates are heap/JS boundaries, **not** OS security boundaries for native
code. LLVM IsolateVM PR #1158 has a trusted in-process experimental host; it
does NOT currently provide an OS sandbox. Never admit untrusted browser code
to it as though it were an isolation security guarantee.

## Phased implementation

1. CURRENT: pure Oreslang policy gates, native Oreslang test vectors,
   actor epoch ordering demo, static workflow and native-only test harness.
2. Trusted actor-based BrowserSupervisor, canonical origin service and
   process registry, typed capability grants, page/tab/frame identity and
   pending/committed navigation transitions. No real web content before this.
3. OS-sandboxed renderer subprocesses, browser/renderer authenticated bounded
   IPC, real IsolateVM wiring, crash recovery and hostile tenant test harness.
4. Brokered HTTP/TLS/redirects, cookies, CSP/CORS/CORP/COOP/COEP, storage,
   service-worker lifecycle and partitioning, HTML parser and CSS/DOM/layout.
5. Rendering/compositor, input and accessibility, tab UI, and JS contexts/
   workers (host V8 adapter or independent compatible JS runtime).
6. Cross-backend native guest evidence on .java, .llvm, .wasm, .forge, .net
   including OS crash containment, memory/CPU budgets and origin confusion.

## Evidence requirements

The source audit is static and cannot establish real guest execution.
The native shell harness requires a trusted external Oreslang binary with
SHA256 pin, exact clean Git checkout, compiler check and byte-exact stdout
for all eleven manifested native guest fixtures. A queued or zero-step GitHub Actions job is
**NOT_EXECUTED**, not pass/fail execution evidence. This project has not yet
proved compilation or execution of these guests, nor any real HTML navigation.

## Native desktop / background services extension

See [DESKTOP_APP.md](DESKTOP_APP.md) for the native tab strip, address bar,
service-worker lifecycle, notification UX and security gating plan. The
second source slice is Oreslang-only policy/actor code; it has NOT created
a real OS window, sandbox, network request or rendered web content.
