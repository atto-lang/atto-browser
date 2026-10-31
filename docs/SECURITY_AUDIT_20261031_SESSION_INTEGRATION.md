# Native Qt browser session and ABI integration contract (DRAFT)

This PR is stacked on snapshot ACK PR #11 at immutable parent `ec82ce91b1254eb031027705059e4948c9ec8148`. It reconciles the proposed two-session ABI contract of PR #8 with startup record validation PR #12 and the bounded UI queue in PR #9. It does **not** merge or close the separate PRs.

## Security contracts

- Startup `OresBrowserConfig` must be exactly ABI v1, correct size, private_session 0/1, reserved zero. The Qt preflight is not native tenant authorization; the actual compiled Oreslang supervisor must revalidate.
- `NEW_TAB`, `NEXT_TAB`, `PREVIOUS_TAB` are *session-scoped* operations with tab ID and generation exactly zero; no URL for NEXT/PREV. An optional canonically padded URL on NEW_TAB is a wire-format allowance only and never authorizes a navigation.
- All tab-specific operations require nonzero tab identity and generation; Oreslang checks session ownership and staleness.
- Qt checks command shape **before** copying UTF-16 text into queued lambdas. The 64-command count bound and 2048-unit URL capture limit remain unchanged.
- Existing worker-to-UI one-snapshot revision ACK backpressure and chrome-text anti-spoofing predicates remain unchanged.
- Integration fixture tests two independently opened handles, separate tabs/revision ledgers, wrong-generation commands, invalid startup records and session-scoped navigation.
- The ABI remains prospective until linked to real Oreslang AOT exports; a host-only compiled integration probe is not guest execution.

## Required independent gates

1. Exact Git blobs and portable C11/C++17 tests, GCC/Clang sanitizers.
2. Real Qt 6/QML event-loop test and deliberately hung-FFI shutdown.
3. Exact-head linked Oreslang AOT backend and two-session guest execution.
4. Source-origin executable GitHub Actions and independent security review.
5. OS process sandbox, site isolation, authenticated IPC and actor lifecycle security.

**DRAFT / HOLD.** A zero-step Actions failure is NOT_EXECUTED, not a failing code test. Cross-org private source mirroring remains blocked by issue #4 until independent approval. No browser-completeness or production-security claim.
