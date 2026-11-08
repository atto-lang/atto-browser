# atto-browser

Browser runtime APIs and JavaScript interoperability for AttoLang applications.

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

AttoLang is the public name; preserve existing Oreslang/.ores compatibility and use canonical .atto for new portable library source. This README defines scope, not feature readiness.

**Acceptance:** name exact source SHA/tree, runtime/toolchain, positive and negative checks and execution receipt before claiming support. Host-only tests and empty CI steps do not prove guest execution.
