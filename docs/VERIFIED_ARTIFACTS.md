# Verified Wasm guest loading

loadVerifiedCoreGuest(rawBytes,manifest) is an experimental browser-side gate for core Wasm scalar i64 guest modules. It snapshots and inspects original bytes, verifies SHA-256 through WebCrypto, enforces a fixed bounded module memory and exact exported entry, rejects host imports, requires zero declared capabilities, and then instantiates. It does not consume precompiled opaque WebAssembly.Module values.

The canonical schema resides in oreslang-target-profiles (core-wasm-artifact.schema.json); keep v1 field names in sync. A manifest does not grant host authority or attest compiler-source correspondence. This first ABI has no host I/O and no actor, structured ownership, WIT/WASI or source-effect checking. Untrusted execution requires a separately terminable worker and CPU/fuel policy.


## Optional sealed scalar AOT export gate

`loadVerifiedCoreGuest(rawBytes,manifest,{sealedExports:true})` now rejects
every export except the exact `main:()->i64` function and one private
bounded `memory`. The export check runs after content SHA-256 verification,
Wasm section admission and engine validation but **before guest
instantiation**. It rejects extra diagnostic functions, alternate entry
names and other hidden public reachability roots. It does not add any host
imports or capabilities. The default `sealedExports:false` preserves the
legacy browser runtime ABI until dependent consumers migrate explicitly.

The same strict two-export boundary is required in the native
`oreslang-source.wasm` scalar profile and its browser-targeted preflight.
Tests use real, valid synthetic wasm32 modules: a 42-returning scalar guest
passes, while a compatible guest that also exports a `diagnostic` function
fails only under the sealed option.

**Scope:** This is a browser WebAssembly loader hardening option, not native
Wasmtime full AOT, a prohibition of engine-internal JIT or host GC, a claim
that source-level actors/SoA have been compiled, or proof of OS isolation.
The browser may still JIT/GC; untrusted execution remains confined to a
separately managed Worker with independent termination policy.
