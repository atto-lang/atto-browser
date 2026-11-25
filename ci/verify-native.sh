#!/bin/sh
# Tests genuine .ores source; fail closed; no JS/Python guest simulator.
set -eu
export LC_ALL=C
cd "$(dirname "$0")/.."
die() { printf '%s\n' "$*" >&2; exit 1; }
command -v git >/dev/null 2>&1 || die "NOT_EXECUTED: git unavailable"
head="$(git rev-parse --verify HEAD)" || die "NOT_EXECUTED: missing HEAD"
[ "${#head}" -eq 40 ] || die "NOT_EXECUTED: invalid source SHA"
[ -n "${EXPECTED_SOURCE_SHA:-}" ] || die "NOT_EXECUTED: source SHA pin required"
tree="$(git rev-parse --verify 'HEAD^{tree}')" || die "NOT_EXECUTED: missing tree"
if [ "$EXPECTED_SOURCE_SHA" != "$head" ]; then
  [ -n "${EXPECTED_SOURCE_TREE:-}" ] && [ "$EXPECTED_SOURCE_TREE" = "$tree" ] ||
    die "NOT_EXECUTED: mirror tree must equal approved source tree"
  [ "${EXPECTED_CHECKOUT_SHA:-}" = "$head" ] ||
    die "NOT_EXECUTED: mirror checkout commit pin required"
fi
[ -z "$(git status --porcelain --untracked-files=all)" ] ||
  die "NOT_EXECUTED: repository checkout dirty"
case "${ORESLANG_BIN:-}" in /*) ;; *) die "NOT_EXECUTED: absolute ORESLANG_BIN required" ;; esac
[ -x "$ORESLANG_BIN" ] || die "NOT_EXECUTED: compiler missing"
case "${ORESLANG_COMPILER_SHA256:-}" in
  "" | *[!0123456789abcdef]*) die "NOT_EXECUTED: pinned compiler SHA256 required" ;;
esac
[ "${#ORESLANG_COMPILER_SHA256}" -eq 64 ] || die "NOT_EXECUTED: invalid compiler SHA256"
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$ORESLANG_BIN" | cut -d ' ' -f 1)"
elif command -v shasum >/dev/null 2>&1; then
  actual="$(shasum -a 256 "$ORESLANG_BIN" | cut -d ' ' -f 1)"
else
  die "NOT_EXECUTED: no SHA256 utility"
fi
[ "$actual" = "$ORESLANG_COMPILER_SHA256" ] || die "NOT_EXECUTED: compiler SHA256 mismatch"
limiter="$(command -v timeout || command -v gtimeout || true)"
[ -n "$limiter" ] || die "NOT_EXECUTED: timeout utility required"
tmp="$(mktemp -d)" || die "NOT_EXECUTED: mktemp unavailable"
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
chmod 700 "$tmp"
"$limiter" --kill-after=5s 15s "$ORESLANG_BIN" --build-info > "$tmp/info" ||
  die "NOT_EXECUTED: compiler build info failed"
grep -Fq '"guest_execution":' "$tmp/info" || die "NOT_EXECUTED: no guest build info"
grep -Fq '"build_mode":' "$tmp/info" || die "NOT_EXECUTED: no build mode"
count=0
while IFS='|' read -r source expected || [ -n "$source" ]; do
  [ -n "$source" ] || continue
  case "$source" in
    tests/guest/isolation_policy.ores | tests/guest/site_tenant_policy.ores | \
    tests/guest/frame_routing_policy.ores | src/browser/window_frame_graph.ores | \
    tests/guest/dynamic_frame_registry.ores | \
    src/browser/window_frame_registry_actor.ores | src/browser/session_lifecycle.ores | \
    src/browser/renderer_supervisor.ores | src/browser/browser_supervisor.ores | \
    src/browser/tab_epoch.ores | \
    tests/guest/tab_policy.ores | tests/guest/ui_dispatch_policy.ores | \
    src/desktop/tab_session.ores | \
    src/desktop/window_tab_strip.ores | \
    tests/guest/notification_policy.ores | \
    tests/guest/service_worker_policy.ores | src/workers/lifecycle.ores) ;;
    *) die "INVALID_CASE_PATH: $source" ;;
  esac
  case "$expected" in
    browser:isolation-policy-ok | browser:site-tenant-policy-ok | \
    browser:frame-routing-policy-ok | browser:frame-graph-ok | \
    browser:dynamic-frame-registry-ok | browser:dynamic-registry-actor-ok | browser:session-lifecycle-ok | \
    browser:renderer-supervisor-ok | browser:supervisor-tabs-ok | \
    browser:tab-epoch-ok | \
    browser:desktop-policy-ok | browser:ui-ffi-policy-ok | \
    browser:tab-session-ok | \
    browser:tab-strip-ok | browser:notifications-policy-ok | \
    browser:service-worker-policy-ok | browser:worker-lifecycle-ok) ;;
    *) die "INVALID_EXPECTED_OUTPUT: $source" ;;
  esac
  [ -f "$source" ] || die "MISSING_SOURCE: $source"
  git ls-files --error-unmatch "$source" >/dev/null || die "UNTRACKED_SOURCE"
  if grep -Fxq "$source" "$tmp/seen" 2>/dev/null; then die "DUPLICATE_CASE: $source"; fi
  printf '%s\n' "$source" >> "$tmp/seen"
  case "$source|$expected" in
    "tests/guest/isolation_policy.ores|browser:isolation-policy-ok") ;;
    "tests/guest/site_tenant_policy.ores|browser:site-tenant-policy-ok") ;;
    "tests/guest/frame_routing_policy.ores|browser:frame-routing-policy-ok") ;;
    "src/browser/window_frame_graph.ores|browser:frame-graph-ok") ;;
    "tests/guest/dynamic_frame_registry.ores|browser:dynamic-frame-registry-ok") ;;
    "src/browser/window_frame_registry_actor.ores|browser:dynamic-registry-actor-ok") ;;
    "src/browser/session_lifecycle.ores|browser:session-lifecycle-ok") ;;
    "src/browser/renderer_supervisor.ores|browser:renderer-supervisor-ok") ;;
    "src/browser/browser_supervisor.ores|browser:supervisor-tabs-ok") ;;
    "src/browser/tab_epoch.ores|browser:tab-epoch-ok") ;;
    "tests/guest/tab_policy.ores|browser:desktop-policy-ok") ;;
    "tests/guest/ui_dispatch_policy.ores|browser:ui-ffi-policy-ok") ;;
    "src/desktop/tab_session.ores|browser:tab-session-ok") ;;
    "src/desktop/window_tab_strip.ores|browser:tab-strip-ok") ;;
    "tests/guest/notification_policy.ores|browser:notifications-policy-ok") ;;
    "tests/guest/service_worker_policy.ores|browser:service-worker-policy-ok") ;;
    "src/workers/lifecycle.ores|browser:worker-lifecycle-ok") ;;
    *) die "CASE_EXPECTED_PAIR_MISMATCH: $source" ;;
  esac
  "$limiter" --kill-after=5s 25s "$ORESLANG_BIN" --check "$source" > "$tmp/check" 2> "$tmp/check.err" ||
    { cat "$tmp/check.err" >&2; die "NATIVE_CHECK_FAILED: $source"; }
  "$limiter" --kill-after=5s 25s "$ORESLANG_BIN" "$source" > "$tmp/output" 2> "$tmp/exec.err" ||
    { cat "$tmp/exec.err" >&2; die "NATIVE_EXEC_FAILED: $source"; }
  printf '%s' "$expected" > "$tmp/expected"
  cmp -s "$tmp/expected" "$tmp/output" || die "NATIVE_OUTPUT_MISMATCH: $source"
  count=$((count + 1))
  printf 'NATIVE_CASE_PASS path=%s source_blob=%s\n' "$source" "$(git rev-parse "HEAD:$source")"
done < ci/native-cases.txt
[ "$count" -eq 17 ] || die "NATIVE_CASE_COVERAGE_MISMATCH"
[ "$(wc -l < "$tmp/seen" | tr -d ' ')" -eq 17 ] || die "NATIVE_DUPLICATE_COVERAGE"
printf 'NATIVE_ACCEPTANCE_PASS count=%s source_sha=%s checkout_sha=%s tree_sha=%s compiler_sha256=%s\n' "$count" "$EXPECTED_SOURCE_SHA" "$head" "$tree" "$actual"
