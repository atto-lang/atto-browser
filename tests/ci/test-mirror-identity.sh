#!/bin/sh
# Hermetic, synthetic Git repositories only: no private source transfer.
set -eu
export LC_ALL=C
cd "$(dirname "$0")/../.."
verifier=$(pwd)/ci/verify-mirror-identity.sh
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
git init -q "$tmp/repo"
cd "$tmp/repo"
git config user.name "Mirror Identity Test"
git config user.email "mirror-test@example.invalid"
printf 'synthetic file only\n' > example.txt
git add example.txt
git commit -qm "synthetic source"
source_sha=$(git rev-parse HEAD)
source_tree=$(git rev-parse 'HEAD^{tree}')
assert_pass() {
  EXPECTED_SOURCE_SHA="$1" EXPECTED_SOURCE_TREE="$2" \
    EXPECTED_CHECKOUT_SHA="$3" sh "$verifier" >/dev/null
}
assert_fail() {
  if EXPECTED_SOURCE_SHA="$1" EXPECTED_SOURCE_TREE="$2" \
      EXPECTED_CHECKOUT_SHA="$3" sh "$verifier" >"$tmp/out" 2>"$tmp/err"; then
    echo "FAIL: identity guard wrongly accepted mismatch" >&2
    exit 1
  fi
  grep -Fq 'EXACT_TREE_IDENTITY_FAIL' "$tmp/err"
}
assert_pass "$source_sha" "$source_tree" "$source_sha"
# A mirror commit has a different commit hash but exactly identical tree.
git commit --allow-empty -qm "synthetic mirror checkout"
mirror_sha=$(git rev-parse HEAD)
[ "$mirror_sha" != "$source_sha" ]
[ "$(git rev-parse 'HEAD^{tree}')" = "$source_tree" ]
assert_pass "$source_sha" "$source_tree" "$mirror_sha"
assert_fail "$source_sha" "$source_tree" "$source_sha"
assert_fail "$source_sha" 0000000000000000000000000000000000000000 "$mirror_sha"
assert_fail INVALID "$source_tree" "$mirror_sha"
assert_fail "$source_sha" "$source_tree" ""
printf 'untracked\n' > unexpected-file
assert_fail "$source_sha" "$source_tree" "$mirror_sha"
rm unexpected-file
printf 'modified\n' >> example.txt
assert_fail "$source_sha" "$source_tree" "$mirror_sha"
git restore example.txt
assert_pass "$source_sha" "$source_tree" "$mirror_sha"
printf 'MIRROR_IDENTITY_NEGATIVE_TESTS_PASS\n'
