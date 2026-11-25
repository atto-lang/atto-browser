> **AI agent instructions (organization-wide):** Before working on code, issues, or pull requests, read and follow the [organization `AGENTS.md`](https://github.com/atto-lang/.github/blob/main/AGENTS.md), including its **merge-first stealth-development policy**. Honor any repository-local `AGENTS.md`, explicit holds, and GitHub-enforced rules.

# atto-browser

Browser runtime APIs and JavaScript interoperability for AttoLang applications.

## Naming migration and language authority

This repository is maintained at [atto-lang/atto-browser](https://github.com/atto-lang/atto-browser); use `https://github.com/atto-lang/atto-browser.git` for Git remotes and canonical `.atto` source examples. The normative language contract is [atto-spec](https://github.com/atto-lang/atto-spec), with executable guest evidence tracked by [atto-platform-conformance](https://github.com/atto-lang/atto-platform-conformance). Follow current ownership, borrowing, effects, actor, and syntax rules there; do not infer implemented features from a README or unexecuted CI.

## Scope

Browser integration APIs, worker interoperability, and web security boundaries.

## Compatibility and design

This package is intended to integrate with [AttoLang](https://github.com/atto-lang) while clearly separating portable language behavior from backend- and host-specific features. Document APIs, target restrictions, and security/trust boundaries.

## Development and verification

Refer to checked-in sources and CI workflows for verified build and test commands. Include platform-specific execution tests and publish exact-commit evidence before asserting backend parity or production readiness.

## Project status

This README describes the intended repository scope and does not imply implemented functionality or verified target coverage.

## Related

- [Language specification](https://github.com/atto-lang/atto-spec)
- [Platform conformance](https://github.com/atto-lang/atto-platform-conformance)

## Repository ownership and contribution routing

**Belongs here:** Reusable browser-facing AttoLang APIs, DOM and Web Worker interop, capability-scoped host bridges and browser lifecycle adapters.

**Belongs elsewhere:** JS lowering belongs in atto-source.js, Wasm compiler/runtime lowering in atto-source.wasm, the playground UI/release in atto-playground.

**Security and portability boundary:** Browser worker boundaries are not per-actor memory protection by themselves. Validate messages, bound quotas, reject unsafe host imports, and handle worker termination/cancellation races.

AttoLang is the canonical project name; new source, examples and documentation use `.atto` and the `atto-lang` repository organization. This README defines scope, not feature readiness.

**Acceptance:** name exact source SHA/tree, runtime/toolchain, positive and negative checks and execution receipt before claiming support. Host-only tests and empty CI steps do not prove guest execution.

## Legacy provenance and transfer verification

Related historical browser projects include `ores-truffle-oreslang/oreslang-web-browser.ores` and `ores-truffle-oreslang/oreslang-browser`; their identities and migration histories must be verified separately. The present checkout is `atto-lang/atto-browser`; matching names or imported history do not prove preserved numeric repository identity or runtime parity. Preserve working legacy `.ores` inputs and historical package/CLI aliases until compiler-backed replacements and consumers are verified. New source follows canonical `.atto` contracts.

Browser APIs, embedding and UI experiments belong here; browser-engine security certification and managed browser services do not. [atto-lang](https://github.com/atto-lang) maintains language, portable libraries and tooling; [atto-co](https://github.com/atto-co) separately governs commercial deployment, tenancy, identity and billing. Further original-ID transfers or commercial carve-outs require separate owner authorization and independent security review. This document authorizes no transfer or private-source mirror.

Before an authorized transfer, coordinate in [migration issue #26](https://github.com/ores-truffle-oreslang/.github/issues/26) and review the authorized runbook. Record source and target administrators, numeric repository ID, exact SHA/tree, history, visibility, access and rulesets, PRs/issues, releases, packages, consumers, CI/runners, secrets, deploy keys, apps, webhooks, Pages and rollback ownership. Verify unchanged ID/history/tree and restored controls after transfer, then execute exact-head tests before changing consumers. Zero-step jobs are NOT_EXECUTED; host-only and source-free checks do not certify compiled guest execution or production capabilities.
