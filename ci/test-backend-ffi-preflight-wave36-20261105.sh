#!/usr/bin/env bash
# Negative host-only exact-source and FFI admission tests. No backend guest runs.
set -euo pipefail
export LC_ALL=C
source_root="$(cd "$(dirname "$0")/.." && pwd -P)"
tmp="$(mktemp -d)"
trap 'rm -rf -- "$tmp"' EXIT
checkout="$tmp/checkout"
mkdir -p "$checkout/ci"
cp "$source_root/ci/verify-backend-ffi.sh" "$checkout/ci/verify-backend-ffi.sh"
git init -q "$checkout"
git -C "$checkout" config user.name "Browser preflight fixture"
git -C "$checkout" config user.email "fixture@example.invalid"
git -C "$checkout" add .
git -C "$checkout" commit -qm "immutable source fixture"
head="$(git -C "$checkout" rev-parse HEAD)"
tree="$(git -C "$checkout" rev-parse 'HEAD^{tree}')"
bad() {
    local expected="$1"
    shift
    if env "$@" sh "$checkout/ci/verify-backend-ffi.sh" >"$tmp/out" 2>"$tmp/err"; then
        echo "HOST_FFI_ADMISSION_FALSE_PASS: $expected" >&2
        exit 1
    fi
    grep -Fq "$expected" "$tmp/err" || {
        cat "$tmp/err" >&2
        echo "HOST_FFI_DENIAL_UNEXPECTED: $expected" >&2
        exit 1
    }
}
# A correct checkout without a real backend is explicitly NOT_EXECUTED.
bad "absolute ORES_BROWSER_BACKEND_LIB required" \
    EXPECTED_SOURCE_SHA="$head" ORES_BROWSER_BACKEND_LIB=""
# The untrusted source SHA cannot be silently replaced by a different commit.
bad "mirror tree not verified" \
    EXPECTED_SOURCE_SHA="$(printf '0%.0s' {1..40})" \
    ORES_BROWSER_BACKEND_LIB=""
# A source tree alone is not a permitted replacement for checkout identity.
bad "mirror checkout commit pin required" \
    EXPECTED_SOURCE_SHA="$(printf '0%.0s' {1..40})" \
    EXPECTED_SOURCE_TREE="$tree" ORES_BROWSER_BACKEND_LIB=""
# Even with all caller-supplied mirror pins, a relative backend is invalid.
bad "absolute ORES_BROWSER_BACKEND_LIB required" \
    EXPECTED_SOURCE_SHA="$(printf '0%.0s' {1..40})" \
    EXPECTED_SOURCE_TREE="$tree" EXPECTED_CHECKOUT_SHA="$head" \
    ORES_BROWSER_BACKEND_LIB="relative/backend.so"
# The admitted checkout cannot contain extra unreviewed source files.
printf 'unreviewed\n' > "$checkout/rogue.txt"
bad "repository checkout dirty" \
    EXPECTED_SOURCE_SHA="$head" ORES_BROWSER_BACKEND_LIB=""
rm "$checkout/rogue.txt"
bad "backend library missing or symlinked" \
    EXPECTED_SOURCE_SHA="$head" ORES_BROWSER_BACKEND_LIB="$tmp/absent.so"
printf 'HOST_ONLY_BROWSER_FFI_PREFLIGHT_PASS negatives=6 NOT_GUEST_EXECUTION\n'
