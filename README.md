# Oreslang Web Browser

**Oreslang-first, actor-native browser prototype** with intended strict
per-tenant/per-origin process isolation. This new repository is NOT YET a
working browser or OS security sandbox.

## Implemented in this initial branch

- Native Oreslang pure admission gates in src/isolation/policy.ores:
  tenant+origin renderer reuse, same-origin DOM checks, targeted cross-origin
  messaging, generation/epoch-fenced renderer IPC and navigation commits.
- Native Oreslang TabEpochActor in src/browser/tab_epoch.ores with monotonic
  accepted epochs and duplicate/stale rejection.
- Native Oreslang guest policy fixture in tests/guest/isolation_policy.ores.
- Static source audit workflow and a manual, fail-closed native acceptance
  runner. There is no JS/Node/Python browser logic or fallback simulator.

### Verification

Run the static audit (NOT a compiler test):

    sh ci/check-source.sh

Run actual Oreslang guests against an independently trusted compiler build:

    ORESLANG_BIN=/absolute/path/to/oreslang-compiler \
    ORESLANG_COMPILER_SHA256=<64-hex-verified-compiler-digest> \
    EXPECTED_SOURCE_SHA="$(git rev-parse HEAD)" \
    sh ci/verify-native.sh

The native runner refuses to claim success without compiler provenance,
an executable compiler, clean exact checkout, source checks and byte-for-byte
execution results. At PR creation no genuine native execution has been
demonstrated; compiler runs must be recorded separately.

## Next milestones

Trusted BrowserSupervisor and canonical URL/origin assignment; OS-sandboxed
renderer workers using OresVM/IsolateVM; typed capability/IPC messages;
navigation and cross-origin iframe coordination; network/TLS, HTML/CSS/DOM,
compositor and JavaScript realms. See docs/ARCHITECTURE.md for the threat
model, contract and order. **Nothing here loads web pages or executes untrusted
website JavaScript yet.**
