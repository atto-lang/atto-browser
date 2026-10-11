# Verified Wasm guest loading

loadVerifiedCoreGuest(rawBytes,manifest) is an experimental browser-side gate for core Wasm scalar i64 guest modules. It snapshots and inspects original bytes, verifies SHA-256 through WebCrypto, enforces a fixed bounded module memory and exact exported entry, rejects host imports, requires zero declared capabilities, and then instantiates. It does not consume precompiled opaque WebAssembly.Module values.

The canonical schema resides in oreslang-target-profiles (core-wasm-artifact.schema.json); keep v1 field names in sync. A manifest does not grant host authority or attest compiler-source correspondence. This first ABI has no host I/O and no actor, structured ownership, WIT/WASI or source-effect checking. Untrusted execution requires a separately terminable worker and CPU/fuel policy.
