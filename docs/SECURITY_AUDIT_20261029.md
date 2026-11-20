# Qt/QML ↔ Oreslang FFI security audit — 2026-10-29

Status: **hardening landed in draft PR #1; NOT merge-ready**.

## Verified remediation at head b347cb07b3059ca8323078b24ba1673e1980c894

| Finding | Severity | Remediation | Evidence |
|---|---|---|---|
| Untrusted webpage tab title treated as automatic rich text | High | QML tab title explicitly Text.PlainText and backend string controls sanitized for display | Source change; Qt GUI not yet compiled |
| Implicit library suffix probing and symlinked code loading | High | Exact OS-specific library file, canonical app directory regular-file check, reject symlink, resolve all symbols | Source change; not code-signing or TOCTOU-proof |
| Same-revision snapshot contents may change undetected | High | Compare entire canonical 143384-byte wire snapshot when revision repeats; reject mutation | Source change; Qt runtime not executed |
| Invalid/duplicate IDs, malformed flags, unused slot leakage, smuggled commands | High | Portable allocation-free C wire validator with canonical-zero invariants, integrate at Qt bridge input/output | C11+C++17 host build tests executed |
| Wrong-order or repeated tab/document state | Medium | Existing per-tenant/epoch Oreslang predicates retained | Existing native guest sources, execution unverified |
| GUI hangs forever on synchronous worker teardown | High | Queue shutdown; wait up to 3 s; fail-stop entire process with exit 70 on timeout | Source change; runtime OS process test still needed |
| Malformed UTF-8 / Unicode direction overrides in chrome URL | High | Validate strict UTF-8 roundtrip and reject bidi/C0/C1 control code points; replace controls in untrusted titles | Source change; Qt GUI not yet compiled |

## Independently executed tests

The following Git blob contents were reproduced and SHA-matched in an isolated local container, then compiled with the normal host toolchains:

- `include/ores_browser_ui_abi_v1.h`: `66b73b8454859adfa86cf4e3cbacfa029f3248d7`
- `include/ores_browser_wire_validate_v1.h`: `969a156fa0729b9628a68ce5c6973867894275b3`
- `tests/abi/header_smoke.c`: `00c25788ddf5be65e3828fc8f77ca8105c4dfcdd`
- `tests/abi/header_smoke.cpp`: `ecc97795d97505a145bce79edf58153983cc5bd8`
- `tests/abi/wire_adversarial.c`: `9886c009ed704864b54480d07115e8dc9ccd1fd3`

C11 `-Wall -Wextra -Werror -pedantic` and C++17 `-Wall -Wextra -Werror -pedantic` ABI tests passed. The adversarial wire test passed with GCC normal build and Clang `-fsanitize=address,undefined -fno-omit-frame-pointer` with ASan leak detection on.

**Scope of test evidence:** C value layout and wire validation only. Not Qt 6 execution, not Oreslang source compilation, not real sandbox or cross-backend behavior. `ci/check-qt-ffi.sh` is updated to run all three host test binaries automatically on a runner with actual executed steps.

The current source-org Actions run for this head:
https://github.com/ores-truffle-oreslang/oreslang-web-browser.ores/actions/runs/40931094019
shows completed/failure with the only job reporting `steps=null`. This **does not** prove a failing C test, a successful test or any Oreslang execution.

## Unresolved release blockers (do not claim secured browser)

1. Real **compiled Oreslang BrowserSupervisor AOT library** implementing all five ABI exports and owning actual tab state, authorization and complete actor lifecycle. Upstream issue: https://github.com/ores-truffle-oreslang/oreslang-source.llvm/issues/1163.
2. Qt 6 GUI configure/build and QML component tests across macOS/Linux/Windows, with malicious tab title/URL inputs, ABI wrong sizes, plugin substitution and hung foreign-code shutdown tests. No Qt 6 Quick toolchain in current test container.
3. Trustenticated release packaging: **sign and verify** all executable/library/dependency objects, safe install/update directories, prevent symlink/TOCTOU/substitute loading and OS loader dependency hijack. Canonical path validation alone is insufficient.
4. Move potentially faulty native/guest execution into separately sandboxed renderer processes and authenticated bounded IPC; an in-process Qt FFI call shares memory and crash fate with its backend. `std::_Exit(70)` is a stopgap for shutdown only.
5. Origin/opaque-origin handling, process sandbox, CSP/CORS/COOP/COEP, navigation state, service-worker storage/notification brokers and hard untrusted-web execution limits are NOT implemented.
6. Native Oreslang source fixture execution (nine programs), LLVM/Java behavior comparison, and OS-level crash/replay/sandbox tests.

The Qt adapter remains a frontend/transport only; every browser operation and permission policy must remain Oreslang-owned.
