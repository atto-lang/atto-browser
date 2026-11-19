> **AI agent instructions (organization-wide):** Before working on code, issues, or pull requests, read and follow the [organization `AGENTS.md`](https://github.com/ores-truffle-oreslang/.github/blob/main/AGENTS.md), including its **merge-first stealth-development policy**. Honor any repository-local `AGENTS.md`, explicit holds, and GitHub-enforced rules.

# Oreslang browser host

## Oreslang → AttoLang project migration (2026-11-18)

The public language name is **AttoLang** (formerly **Oreslang**). This is the legacy `ores-truffle-oreslang/oreslang-browser` repository. New corresponding AttoLang work belongs in **[atto-lang/atto-browser](https://github.com/atto-lang/atto-browser)**. Do not infer identical Git histories, issues, PRs, execution evidence or completed ownership transfer from matching project names. A browser frontend/worker is not automatically a safe untrusted guest execution boundary.

The **canonical language specification** is [atto-lang/atto-spec](https://github.com/atto-lang/atto-spec), not an older Oreslang README or historical specification copy. [atto-platform-conformance](https://github.com/atto-lang/atto-platform-conformance) owns portable executed guest tests, [atto-compilers-parity-testing](https://github.com/atto-lang/atto-compilers-parity-testing) owns differential checks, and [atto-common-source](https://github.com/atto-lang/atto-common-source) owns portable `.atto` libraries. Current design targets include `snake_case` names, `borrow!`/`take!`/`copy!`/`copy!!`/`share!`, [implicit borrowing](https://github.com/atto-lang/atto-spec/blob/main/language/implicit-argument-borrow-v1.md), [file/module constants including one-time non-throwing `os.read_env`](https://github.com/atto-lang/atto-spec/blob/main/language/file-module-const-v1.md), and [`<<<`/`>>>`/`ashr` shifts distinct from stream `<<`/`>>`](https://github.com/atto-lang/atto-spec/blob/main/language/bitwise-and-stream-operators-v1.md). These are normative/proposed targets; unsupported syntax must fail closed.

Preserve legacy `.ores` fixtures, historical CLI/package names and ABI/wire contracts until replacements are verified. Do not use Python for new AttoLang scripts/tests/CI; prefer Rust for support tooling. Report exact SHA/tree, toolchain, positive/negative compiled guest runs and explicit failed/unsupported/not-executed states; host-only tests and zero executed Actions steps do not prove guest parity.

**Status:** real tested browser-compatible **WebAssembly host loader prototype**, not a browser Oreslang compiler, JavaScript backend, actor scheduler, DOM bridge, or completed security sandbox.

This package loads **raw core Wasm bytes** using the standard WebAssembly API, rejects modules with start sections, tables, unbounded or over-budget linear memory, oversized binaries, or unexpected host imports **before instantiation**, and exposes an explicitly requested and independently granted clock import. Passing a precompiled `WebAssembly.Module` is intentionally rejected because its source bytes cannot be inspected. Neither browser global access nor a source header grants anything.

## Quick start

~~~sh
npm test
~~~

~~~js
import { loadOreslangWasm } from "./src/loader.mjs";
const bytes = await (await fetch("./oreslang_rt.wasm")).arrayBuffer();
const result = await loadOreslangWasm(bytes, {
  requestedCapabilities: ["clock"],
  grantedCapabilities: ["clock"],
  host: { clockMs: () => performance.now() }
});
console.log(result.instance.exports.ores_rt_abi_version());
~~~

The wasm32 binary must be built separately, currently with the C ABI prototype in oreslang-wasm (npm run build); copy its build/oreslang_rt.wasm into the example directory for a local static HTTP server. This does **not** compile an Oreslang .ores program.

**Important:** This is not an untrusted-Wasm isolation sandbox. A synchronous Wasm function can consume unbounded CPU, and export calls can perform arbitrary computations before they return. Host applications should run untrusted guests in independently terminable Workers and enforce CPU/size limits. No actor or full sandbox guarantee is claimed.

Runtime admission principles:
- Request and grant are distinct. Requested capabilities must be a subset of independent host grants.
- Imports are inspected with WebAssembly.Module.imports and only the pinned ores_host.clock_ms function is accepted by this v0 adapter.
- Even if a guest calls exported initialization itself, clockMs checks the host-side grant at call time.
- Imports of memory, tables, arbitrary JS modules, filesystem, network, threading or raw DOM are refused.
- The static target profiles registry is not a permission oracle; the embedding application owns the grants.

Next: link the real compiler's Wasm output, browser Web Worker actor scheduler, async host adapters, DOM APIs under capabilities, and conformance runs. This prototype makes none of those claims.
