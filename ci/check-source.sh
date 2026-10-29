#!/bin/sh
# Static shape audit only; NOT compiler execution or security evidence.
set -eu
cd "$(dirname "$0")/.."
test -f src/isolation/policy.ores
test -f src/browser/tab_epoch.ores
test -f tests/guest/isolation_policy.ores
test -f ci/native-cases.txt
test "$(grep -c '^[^#].*|browser:' ci/native-cases.txt)" -eq 2
for name in may_reuse_renderer may_read_dom may_post_message may_deliver_renderer_ipc may_commit_navigation; do
  grep -Fq "pub fnc $name(" src/isolation/policy.ores
done
grep -Fq 'define actor TabEpochActor' src/browser/tab_epoch.ores
for term in cross-tenant cross-origin stale-process stale-document stale-navigation; do
  grep -Fq "$term" tests/guest/isolation_policy.ores
done
echo "STATIC_SOURCE_AUDIT_PASS (NOT native execution)"
