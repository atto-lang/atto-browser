#!/bin/sh
# Checkout/tree identity only. Passing this script is NOT authorization to
# transfer private source or proof of compiler/CI execution.
set -eu
export LC_ALL=C
fail() { printf 'EXACT_TREE_IDENTITY_FAIL: %s\n' "$*" >&2; exit 1; }
command -v git >/dev/null 2>&1 || fail "git unavailable"
for variable in EXPECTED_SOURCE_SHA EXPECTED_SOURCE_TREE EXPECTED_CHECKOUT_SHA; do
  eval "value=\${$variable:-}"
  case "$value" in
    "" | *[!0123456789abcdef]*) fail "$variable must be 40 lowercase hex characters" ;;
  esac
  [ "${#value}" -eq 40 ] || fail "$variable must be 40 lowercase hex characters"
done
actual_commit=$(git rev-parse --verify HEAD) || fail "no HEAD commit"
actual_tree=$(git rev-parse --verify 'HEAD^{tree}') || fail "no HEAD tree"
[ "$actual_commit" = "$EXPECTED_CHECKOUT_SHA" ] || fail "checkout SHA mismatch"
[ "$actual_tree" = "$EXPECTED_SOURCE_TREE" ] || fail "source tree mismatch"
if [ "$actual_commit" != "$EXPECTED_SOURCE_SHA" ]; then
  [ "$EXPECTED_SOURCE_SHA" != "$EXPECTED_CHECKOUT_SHA" ] ||
    fail "mirror commit must have a distinct checkout SHA"
fi
[ -z "$(git status --porcelain --untracked-files=all)" ] ||
  fail "checkout contains modified or untracked files"
# Git tree equality also binds tracked path names, file modes and blob IDs.
git ls-tree -r --full-tree HEAD > /dev/null ||
  fail "tree entries inaccessible"
printf 'EXACT_TREE_IDENTITY_PASS source_sha=%s checkout_sha=%s tree_sha=%s\n' \
  "$EXPECTED_SOURCE_SHA" "$actual_commit" "$actual_tree"
