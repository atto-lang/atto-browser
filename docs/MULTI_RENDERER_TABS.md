# Multi-renderer tabs, out-of-process frames and window-owned renderer registry

**Status:** native Oreslang policy and a bounded 2-tab/3-frame actor fixture.
No HTML renderer, real OS subprocess, IsolateVM, compositor, authenticated
frame IPC, or native compiler execution has been established.

## Invariants

- One `TabActor` owns one top-level browsing context's **frame tree** and
  history/navigation intent. A tab may contain zero, one or many live
  renderers, and renderer count need not equal frame count.
- One `RendererSupervisorActor` controls one renderer OS process and
  generation, regardless of how many frames/tabs reference that renderer.
  This actor belongs to the Oreslang `WindowSupervisor`, NOT a tab.
- One site-locked sandboxed `RendererProcess` runs one primary site
  IsolateVM and distinct exact-origin JS realms where explicitly safe.
  A renderer can be reused by compatible frames in **different tabs of
  the same window**, same profile/partition, site/process lock,
  browsing-context/agent-cluster policy, and generation. High-risk
  subdomains/COOP/OAC/opaque origins may require additional renderers.
- Parent/child frame relationships are independent of process assignment:
  a cross-site iframe is an **out-of-process iframe (OOPIF)**. The
  parent has a browser-issued frame proxy but cannot directly access
  another origin's DOM/heap or privileged OS handles.
- The `WindowFrameRegistryActor` is the intended sole authority for
  `(window_id, tab_id, frame_id, document_epoch) -> (renderer_id,
  renderer_generation, site_tenant_id, origin_id, partition_id)`.
  The registry assigns stable, never-recycled-in-session frame IDs,
  monotonic document epochs and renderer generations. A separate table
  maps renderer IDs to exactly one controlling actor and OS process.
  These maps must be linearizable with bounded capacity and no
  cross-window or cross-profile aliases.
- `ProfileBroker` owns authorization and site classification, whereas
  WindowSupervisor owns frame tree, renderer registry, process refcounts,
  navigation and compositor routing. Qt/QML only submits user intent
  and paints privileged chrome: it does not choose or trust renderer IDs.

## Example: two tabs, two renderer processes, three frames

```text
Window #1: WindowSupervisor (single Oreslang control process)
  TabActor #11
    Frame #101 top: https://www.example.com    -> Renderer A
    Frame #102 child: https://video.other.com  -> Renderer B (OOPIF)
  TabActor #12
    Frame #201 top: https://api.example.com     -> Renderer A (reuse)

  RendererSupervisorActor A => sandboxed Renderer A, site=example.com
    IsolateVM A with distinct origin realms www.example.com / api.example.com
  RendererSupervisorActor B => sandboxed Renderer B, site=other.com
    IsolateVM B with video.other.com origin realm
  Window compositor paints frame 101, subframe 102, frame 201 into their
    respective tabs using broker-issued generation-fenced surface tickets.
```

Site-level placement does NOT grant origin-level DOM/storage privilege.
Sharing a *process* also means a renderer compromise may read co-resident
origins. Split when this exposure is inappropriate; do not claim process
reuse is an isolation guarantee between sibling origins.

## Frame binding / navigation protocol

1. ProfileBroker canonicalizes URL, determines schemeful site using a
   pinned Public Suffix List, exact origin, top-level site/partition,
   agent-cluster and origin-strict requirements. Renderer content cannot
   supply these privileged outcomes.
2. TabActor requests a child frame using a browser-issued ticket tied to
   live `(window, tab, parent_frame, parent_document_epoch)`. A
   child frame may point to a renderer process DIFFERENT from its parent.
   A fixed frame quota, depth limit and detached subtree constraints
   must be checked by the window registry.
3. RendererRegistry reuses only a **suitable** live renderer or asks the
   trusted process launcher to create a verified sandboxed renderer
   process and then its exactly-one RendererSupervisorActor. Reuse requires
   same window, profile, partition, schemeful site lock, compatible agent
   cluster and process generation. Never weaken process locks on memory
   pressure.
4. Navigation is two-phase: reserve fresh pending document epoch and
   candidate renderer, receive broker-verified commit token and response;
   atomically replace frame-to-renderer binding, update reference counts
   and document epoch, invalidate old surfaces/IPC and release old
   process usage **after** all in-flight operations drain. A rejected
   commit is idempotent and leaves the old frame untouched.
5. Cross-process `postMessage` goes via the privileged broker with an
   exact target origin and frame/document + renderer generation checks.
   Cross-site messages are allowed when spec-compatible; sharing a site
   is NOT a precondition. The existing `may_post_message` bootstrap
   predicate restricts sends to one tenant. It remains unchanged for
   its original stricter scope, and cannot be used for general OOPIF
   messaging: use the new explicit frame broker contract once real IPC
   exists. `targetOrigin="*"` and cross-window opener relationships
   require additional audited semantics.
6. Browser compositor receives only ticketed per-frame surfaces. Reject
   stale document epochs, stale process generations, forged or out-of-bounds
   surfaces, privileged chrome overlays, and input/hit-test mismatches.
   Rendering/lifecycle timing must not allow stale child surfaces to
   remain active after navigation or renderer crash.
7. Closing a tab retires its **entire frame subtree** and releases every
   renderer reference, but only after frame/IPC/surface drains. It must
   not terminate a renderer still hosting a frame in another tab.
   Renderer retirement requires zero live frame references AND zero
   in-flight compositor/IPC handles, an exact generation and trusted
   cleanup receipt. Service-worker registrations remain profile-scoped
   and can outlive tabs under their separate budget/policy.
8. Crashed renderer invalidates all bound frames across all tabs, revokes
   their generations and surfaces, notifies each tab's supervisor,
   provides crash placeholders, and restarts only through trusted process
   admission. Never resurrect a stale process ticket or previous origin
   authority.

## Source files in this PR

- `src/browser/frame_routing_policy.ores`: pure admission functions for
  frame binding, cross-tab renderer reuse, subframe attachment, staged
  navigation, brokered cross-site messaging, surface presentation and
  renderer retirement. Caller-provided IDs and Boolean flags are
  fixture values, NOT authenticated capabilities.
- `tests/guest/frame_routing_policy.ores`: 45 positive/negative policy
  vectors. The native compiler must run these for executable evidence.
- `src/browser/window_frame_graph.ores`: Oreslang actor fixture with
  single sealed `state { ... }` and `handle_state(critical |s| -> ...)`
  transitions, representing exactly 2 tabs, 3 frames, 2 renderers.
  It proves local atomic frame rebind/epoch advancement, derived
  reference counts, stale surface rejection, subtree close and
  independent per-window actor state **if compiled and executed**.
  Command IDs are fixed **test instructions**; they are not a general
  tab/renderer registry and must not be exposed to UI/renderer IPC.

## Required next implementation gates

1. Replace fixed-slot fixture with bounded Oreslang `WindowFrameRegistryActor`,
   typed frames, stable opaque IDs and parent pointers, cycle/depth checks,
   ordered frame subtree destruction, bounded per-tab/window frame quotas,
   document generations and transactional renderer refcounts.
2. Attach authenticated `RendererSupervisorActor` process handles and
   brokered IPC, prove one-to-one actor/renderer ownership across crashes,
   restarts, stale messages and window teardown.
3. Implement real IsolateVM origin realms, agent clusters, renderer process
   sandbox + site locks; verify against independently controlled
   subdomains. Use strict origin-level policy where required.
4. Implement cross-process frame proxies, correctly routed `postMessage`,
   navigation/redirect swap and a surface compositor with input,
   focus, clipping, accessibility and correct hit testing.
5. Compile the native Oreslang sources at exact source/compiler SHAs;
   execute the actor/negative fixtures on actual LLVM and Java/Graal;
   run ASan/UBSan, real process crash/restart and adversarial IPC tests.
   Source-shape checks alone are not proof.

References:
- Chromium process and site reuse: https://chromium.googlesource.com/chromium/src/+/main/docs/process_model_and_site_isolation.md
- Chromium OOPIF architecture: https://www.chromium.org/developers/design-documents/oop-iframes/
