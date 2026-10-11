# Browser adapter security contract v0

The loader uses an independent host-owned grant set, a guest capability-request set, and a fixed import allowlist. Unknown Wasm imports are rejected before instantiation. Even if the module directly calls its exported initialization function with a forged bitmask, host APIs recheck their own grant.

This is defense-in-depth only, not a complete sandbox:
- Callers must supply independently trusted grants. A guest-controlled manifest must not set them.
- Only ores_host.clock_ms is supported; filesystem/network/DOM/threads are not implemented.
- Core Wasm memories, growth, CPU use, JS object reference exchange and resource limits need additional policy checks.
- A module can spin forever or exhaust permitted CPU; browser scheduling and termination are out of scope.
- Core ABI v1 is distinct from the proposed WIT component interface.
- No dynamic Wasm import allowlist extension without explicit review.

Hardening added: raw-byte inspection rejects start functions (which would run during instantiation), table sections, shared/memory64/unbounded memories, modules exceeding the host's page allowance, and binaries over a bounded maximum. Core Wasm module validation remains subject to the engine. A precompiled Module cannot be inspected and is denied. These checks **do not** limit per-call CPU, stack use, or external effects performed by an admitted exported function; isolate untrusted executions into killable Workers with real host resource quotas.
