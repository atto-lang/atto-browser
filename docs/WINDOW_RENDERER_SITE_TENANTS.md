# One Oreslang window process, one actor per renderer, site-tenant isolates

**Status:** accepted architecture target + native Oreslang policy and actor
fixtures. No OS process launcher, trusted PSL resolver, physical IsolateVM
renderer, or authenticated broker is implemented. Existing origin-locked
prototype `src/isolation/policy.ores` remains strict/fail-closed until a
real site process registry and cross-origin broker are integrated.

## Window and renderer topology

```text
ProfileBroker Oreslang process (app-wide / profile-scoped)
  profile authorization, PSL + URL canonicalization, cookie/storage keys,
  worker registration, notifications, secure OS services, permissions
        | authenticated bounded IPC + session generations
        +--- Window 1 = one Oreslang WindowSupervisor process
        |       Qt/QML chrome with narrow C ABI FFI
        |       Tab actors, navigation supervisor
        |       RendererSupervisorActor A (exactly 1 per renderer process)
        |           | signed process/actor handle, bounded IPC
        |           +--> Sandbox renderer process A
        |                    IsolateVM tenant: https://example.com
        |                    origin realm: https://www.example.com:443
        |                    origin realm: https://api.example.com:443
        |       RendererSupervisorActor B (exactly 1 per renderer process)
        |           +--> Sandbox renderer process B
        |                    IsolateVM tenant: https://other.com
        +--- Window 2 = separate Oreslang WindowSupervisor process
                independent Qt/QML surface + distinct renderer processes
                even for https://example.com
```

A renderer **is not a tab**. It can host frames from one schemeful site in
the same window, across tabs, subject to security and agent-cluster rules.
A tab can have several renderers when it contains cross-site iframes or
redirects. A RendererSupervisorActor owns exactly one renderer OS process
handle/generation and sends messages into that process; a renderer process
has exactly one controlling supervisor actor in its window's registry.
The actor itself runs on the trusted window Oreslang actor scheduler,
not in the untrusted renderer process. Domain-specific in-renderer document
and worker actors are separate from this *one supervisor actor* invariant.

Initial policy targets ONE site-locked renderer process / IsolateVM per
(window, browser profile, storage partition, schemeful site). However
browsing-context groups, crossOriginIsolated contexts, agent clusters,
COOP/OAC, workload quotas, and customer-controlled hosting can require
MULTIPLE physical renderer isolates for a site. Never merge unrelated
script worlds solely to enforce a numerical "exactly one" requirement.
The requirement is ONE **controlling actor per renderer instance**, not
global uniqueness of one renderer process per domain across all windows.

One window process is useful for failure isolation, but it must **not**
become the sole global authority for cookies/permissions/storage. The
profile broker survives window close when approved background service-worker
jobs need to finish; no private-session state survives the final private
window. If the Qt GUI and Oreslang window control can run in separate
processes, prefer it for crash containment; the Qt process still uses the
same versioned C ABI via a narrow IPC shim. The existing Qt implementation
loads the native library *in process* and has NOT achieved this topology.

## Domain/site tenant vs origin

- Tenant identity for a website is the **schemeful site**:
  `https://www.example.com`, `https://example.com` and
  `https://api.example.com` resolve to the same site tenant
  `https://example.com` (if owned/managed together).
  **www is an entry-host alias, not an authority marker**: websites
  can live at apex, app, www, subdomain or arbitrary labels.
- Same-site checks use a trusted canonical URL implementation + Public
  Suffix List including relevant private suffixes, e.g.
  `a.github.io` and `b.github.io` must be **different tenants**.
  `company.co.uk` is a separate registrable domain from
  `different.co.uk`. Avoid suffix string tests such as "endsWith .com"
  or blindly dropping one DNS label.
- `http://example.com` and `https://example.com` are different
  schemeful sites. Ports are ignored for site identity but retained for
  origin identity. IDN, IP addresses, localhost, opaque `data:`/`file:`,
  sandboxed documents, inherited `about:blank`/`blob:` origins and
  private-hosting cases require specialized handling before admission.
- The browser's security principal for DOM/JS storage/service workers
  remains an **origin**: (scheme, full host, effective port), or an
  opaque origin nonce. `https://www.example.com` and
  `https://api.example.com` may share a site VM but are different
  JS origins; they must never read each other's DOM/localStorage/IDB/
  service-worker registrations without an explicit spec-defined grant.
- Do NOT use same-site checks for privileged origin grants. The network
  and storage broker must enforce exact canonical origin and partition,
  even if the renderer OS process/IsolateVM is compromised.
- Important threat model: a compromised renderer may read **all same-site
  origins placed inside its own process/VM**. This is a security/performance
  tradeoff versus the original origin-per-renderer design. Offer
  `origin_strict` placement for high-security admin, login, banking and
  customer-controlled tenants; default to splitting any delegated or
  untrusted subdomain hosting. Never claim site-level isolation offers
  full protection **between** its sibling origins.

### Naming (avoid two meanings of "tenant")

| Field | Scope | Issuer |
| --- | --- | --- |
| `profile_id` | user profile/incognito/guest container | ProfileBroker |
| `site_tenant_id` | schemeful eTLD+1, with explicit per-host split exceptions | trusted PSL/origin broker |
| `origin_id` | scheme + full host + port, or opaque nonce | origin broker |
| `storage_partition_id` | profile + top-level site + privacy mode + storage policy | ProfileBroker |
| `window_id` | one OS window-control process, generation fenced | ProfileBroker |
| `renderer_actor_id` | trusted Oreslang actor owning one renderer process | WindowSupervisor |
| `renderer_generation` | epoch for renderer process and IsolateVM lifetime | process launcher |

Positive integers in policy functions are **test fixtures only**. They
must be unforgeable authenticated handles in actual broker IPC; boolean
inputs such as `sandbox_verified`, `hosted_tenant_split_required`, and
`canonical_site_verified` can be set ONLY by the trusted broker, not by
site content or renderer replies.

## Native Oreslang source in this change

- `src/isolation/site_tenant_policy.ores`: pure same-site placement,
  window+profile+partition matching, one-actor ownership, exact-origin
  broker access gates. The policy accepts trusted *classified* site IDs;
  it does NOT parse a URL, implement PSL, or create processes.
- `src/browser/renderer_supervisor.ores`: long-lived actor lifecycle
  fixture for binding a renderer, duplicate rejection, a crash generation
  fence, and graceful close. Its integer messages are **local test
  commands**, not secure IPC, and physical process ownership is pending.
- `tests/guest/site_tenant_policy.ores`: positive same-site subdomain
  colocation and negative cross-window, cross-profile, cross-site,
  partition, stale generation, unverified PSL, unsandboxed renderer,
  untrusted hosting, and sibling-origin resource access cases.

## Multiple renderers per tab

One tab's frame tree may refer to multiple sandboxed renderer processes
via cross-site OOPIFs; a renderer may serve compatible frames of
multiple tabs. This is a many-to-many relation managed by the window
frame registry, **not** by a single TabActor or renderer actor.
Frame/document generation, exact target origin, site/process lock,
agent-cluster compatibility, compositor surface tickets and cross-process
postMessage are separate checks. See [MULTI_RENDERER_TABS.md](MULTI_RENDERER_TABS.md).
The new Oreslang policy and bounded frame graph fixture are not physical
OS processes or working page rendering.

## Release / parity gates

1. Implement canonical site/origin/PSL resolver with at least a current
   pinned Public Suffix List and explicit private-suffix treatment, complete
   IDN/opaque/inherited-origin vectors. Do not use user-entered `www` to
   establish the site tenant.
2. Implement a durable per-profile process/service broker, authenticated
   window registration, and one Oreslang WindowSupervisor **OS process
   per window**. Preserve permission/session revocation across windows.
3. Implement a **linearizable one-to-one mapping**
   `(window_id, renderer_id, renderer_generation) -> renderer_actor_ref`
   with capacity enforcement, anti-replay process tickets, parent-child
   drain and idempotent crash/restart. The pure Oreslang predicate cannot
   itself guarantee this uniqueness.
4. Implement OS-sandboxed renderer subprocess per site tenant/partition
   with physical IsolateVM and **distinct JS origin realms**. Do not allow
   arbitrary native site code in the trusted window/broker process.
5. Brokered navigation, cross-origin iframe routing and worker registration,
   exact-origin resource access even for same-site subdomains, plus COOP/
   COEP/OAC/agent-cluster isolation exceptions.
6. Run exact-head `.ores` fixtures against actual Java/LLVM native compilers,
   then host ABI, Qt GUI and cross-window/multi-process/security tests.
   A source-only static check or zero-step Actions result is NOT native
   execution evidence.

Research:
- Chromium process model: https://chromium.googlesource.com/chromium/src.git/+/HEAD/docs/process_model_and_site_isolation.md
- Web same-site vs same-origin: https://developer.mozilla.org/en-US/docs/Glossary/Site
- Same-origin policy: https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy
- PSL origin validation examples: https://developer.chrome.com/docs/modern-web-guidance/guides/security/validate-origins
