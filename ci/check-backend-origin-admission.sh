#!/bin/sh
# Execute only NEGATIVE/early admission checks. Never dlopen or execute a
# browser backend. This does not certify native Oreslang compiler provenance.
set -eu
cd "$(dirname "$0")/.."
command -v git >/dev/null 2>&1 || exit 2
command -v env >/dev/null 2>&1 || exit 2
head=$(git rev-parse --verify HEAD)
tree=$(git rev-parse --verify 'HEAD^{tree}')
[ "${#head}" -eq 40 ] || exit 2
[ "${#tree}" -eq 40 ] || exit 2
tmp=$(mktemp) || exit 2
trap 'rm -f "$tmp"' EXIT HUP INT TERM
fail() { echo "BACKEND_ORIGIN_ADMISSION_TEST_FAIL: $*" >&2; exit 1; }
expect_denied() {
  label=$1; expected=$2; shift 2
  if env "$@" sh ci/verify-backend-ffi.sh >"$tmp" 2>&1; then
    fail "$label unexpectedly succeeded"
  fi
  grep -Fq "$expected" "$tmp" || {
    cat "$tmp" >&2
    fail "$label rejected for wrong reason"
  }
}
# Pin absent: reject regardless of caller environment.
expect_denied missing-source-pin "source SHA pin required" \
  EXPECTED_SOURCE_SHA= GITHUB_ACTIONS= GITHUB_REPOSITORY= \
  ORES_BROWSER_BACKEND_LIB=
# An exact tree and checkout SHA are NOT sufficient to authorize a private
# mirror. This must fail before any backend-library path check.
expect_denied unapproved-mirror \
  "unapproved private source mirror checkout (issue #4)" \
  EXPECTED_SOURCE_SHA=0000000000000000000000000000000000000000 \
  EXPECTED_SOURCE_TREE="$tree" EXPECTED_CHECKOUT_SHA="$head" \
  GITHUB_ACTIONS= GITHUB_REPOSITORY= ORES_BROWSER_BACKEND_LIB=
# A same-SHA GitHub Actions job from a different repository is unapproved.
expect_denied unapproved-repository \
  "unapproved GitHub Actions repository origin (issue #4)" \
  EXPECTED_SOURCE_SHA="$head" GITHUB_ACTIONS=true \
  GITHUB_REPOSITORY=unapproved/private-test-repo ORES_BROWSER_BACKEND_LIB=
# An exact original checkout must reach the *next* gate, refusing to
# execute without an explicitly selected absolute backend library.
expect_denied original-source-no-backend \
  "absolute ORES_BROWSER_BACKEND_LIB required" \
  EXPECTED_SOURCE_SHA="$head" GITHUB_ACTIONS= \
  GITHUB_REPOSITORY= ORES_BROWSER_BACKEND_LIB=
printf '%s\n' 'BACKEND_ORIGIN_DENIAL_MATRIX_PASS (no backend loaded or executed)'
