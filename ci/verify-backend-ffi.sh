#!/bin/sh
# Run ONLY against a real pinned compiled Oreslang backend; no mock fallback.
set -eu
export LC_ALL=C
cd "$(dirname "$0")/.."
fail() { printf '%s\n' "NOT_EXECUTED: $*" >&2; exit 1; }
command -v git >/dev/null 2>&1 || fail "git unavailable"
command -v cc >/dev/null 2>&1 || fail "C compiler unavailable"
head=$(git rev-parse --verify HEAD) || fail "no Git HEAD"
[ "${#head}" -eq 40 ] || fail "invalid source SHA"
[ "${EXPECTED_SOURCE_SHA:-}" = "$head" ] || fail "EXPECTED_SOURCE_SHA must pin exact head"
[ -z "$(git status --porcelain --untracked-files=normal -- include/ tests/abi/ ci/verify-backend-ffi.sh)" ] ||
  fail "ABI checkout dirty"
case "${ORES_BROWSER_BACKEND_LIB:-}" in
  /*) ;;
  *) fail "absolute ORES_BROWSER_BACKEND_LIB required" ;;
esac
[ -f "$ORES_BROWSER_BACKEND_LIB" ] && [ ! -L "$ORES_BROWSER_BACKEND_LIB" ] ||
  fail "backend library missing or symlinked"
case "${ORES_BROWSER_BACKEND_SHA256:-}" in
  "" | *[!0123456789abcdef]*) fail "lowercase hex SHA256 pin required" ;;
esac
[ "${#ORES_BROWSER_BACKEND_SHA256}" -eq 64 ] || fail "invalid SHA256 length"
if command -v sha256sum >/dev/null 2>&1; then
  actual=$(sha256sum "$ORES_BROWSER_BACKEND_LIB" | cut -d ' ' -f 1)
elif command -v shasum >/dev/null 2>&1; then
  actual=$(shasum -a 256 "$ORES_BROWSER_BACKEND_LIB" | cut -d ' ' -f 1)
else
  fail "SHA256 utility unavailable"
fi
[ "$actual" = "$ORES_BROWSER_BACKEND_SHA256" ] ||
  fail "backend library SHA256 mismatch"
limiter=$(command -v timeout || command -v gtimeout || true)
[ -n "$limiter" ] || fail "timeout utility required"
tmp=$(mktemp -d) || fail "mktemp failed"
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
chmod 700 "$tmp"
# Linux POSIX dlopen contract. Other platforms need platform-native smoke.
cc -std=c11 -Wall -Wextra -Werror -pedantic -I include \
  tests/abi/backend_integration.c -ldl -o "$tmp/backend-ffi"
"$limiter" --kill-after=5s 30s "$tmp/backend-ffi" "$ORES_BROWSER_BACKEND_LIB" ||
  fail "real Oreslang backend FFI execution failed"
printf 'NATIVE_BACKEND_FFI_ACCEPTANCE_PASS source_sha=%s backend_sha256=%s\n' "$head" "$actual"
