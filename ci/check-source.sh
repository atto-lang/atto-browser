#!/bin/sh
# Source-shape checks only. NEVER asserts a native .ores execution.
set -eu
cd "$(dirname "$0")/.."
[ -f ci/native-cases.txt ]
[ "$(grep -c '^[^#].*|browser:' ci/native-cases.txt)" -eq 11 ]
for file in src/isolation/policy.ores src/isolation/site_tenant_policy.ores \
    src/browser/renderer_supervisor.ores src/browser/tab_epoch.ores \
    src/desktop/tab_policy.ores src/desktop/ui_dispatch_policy.ores \
    src/desktop/tab_session.ores \
    src/desktop/window_tab_strip.ores \
    src/notifications/notification_policy.ores \
    src/workers/service_worker_policy.ores src/workers/lifecycle.ores \
    tests/guest/isolation_policy.ores tests/guest/site_tenant_policy.ores \
    tests/guest/tab_policy.ores \
    tests/guest/ui_dispatch_policy.ores \
    tests/guest/notification_policy.ores tests/guest/service_worker_policy.ores; do
  [ -f "$file" ] || { echo "MISSING_SOURCE: $file" >&2; exit 1; }
done
for fn in may_reuse_renderer may_read_dom may_post_message \
    may_deliver_renderer_ipc may_commit_navigation; do
  grep -Fq "pub fnc $fn(" src/isolation/policy.ores
done
for fn in may_open_tab may_focus_tab may_persist_tab_session may_move_tab; do
  grep -Fq "pub fnc $fn(" src/desktop/tab_policy.ores
done
for fn in may_prompt_notifications may_display_notification \
    may_show_worker_notification may_route_notification_click; do
  grep -Fq "pub fnc $fn(" src/notifications/notification_policy.ores
done
for fn in may_register_service_worker may_dispatch_worker_fetch \
    may_promote_waiting_worker may_wake_worker_for_event may_receive_push; do
  grep -Fq "pub fnc $fn(" src/workers/service_worker_policy.ores
done
for fn in may_place_site_renderer may_share_site_isolate \
    may_control_renderer may_access_origin_resource; do
  grep -Fq "pub fnc $fn(" src/isolation/site_tenant_policy.ores
done
grep -Fq 'define actor RendererSupervisorActor' src/browser/renderer_supervisor.ores
grep -Fq 'FAIL:untrusted-hosted-subdomains' tests/guest/site_tenant_policy.ores
grep -Fq 'FAIL:sibling-origin-read' tests/guest/site_tenant_policy.ores
grep -Fq 'define actor TabEpochActor' src/browser/tab_epoch.ores
grep -Fq 'define actor TabSessionActor' src/desktop/tab_session.ores
grep -Fq 'define actor WindowTabStripActor' src/desktop/window_tab_strip.ores
grep -Fq 'define actor WorkerRegistrationActor' src/workers/lifecycle.ores
for term in cross-tenant cross-origin stale-process stale-document stale-navigation; do
  grep -Fq "$term" tests/guest/isolation_policy.ores
done
for term in cross-profile-move private-restore stale-window; do
  grep -Fq "$term" tests/guest/tab_policy.ores
done
for term in synthetic-click replayed-click partition-leak spam-limit dnd; do
  grep -Fq "$term" tests/guest/notification_policy.ores
done
for term in partition-register fetch-partition stale-subscription unapproved-promote queue-overflow; do
  grep -Fq "$term" tests/guest/service_worker_policy.ores
done
grep -Fq "pub fnc may_dispatch_ui_command(" src/desktop/ui_dispatch_policy.ores
grep -Fq "FAIL:stale-tab" tests/guest/ui_dispatch_policy.ores
echo "STATIC_SOURCE_AUDIT_PASS (NOT native execution)"
