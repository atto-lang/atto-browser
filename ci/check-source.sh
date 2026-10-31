#!/bin/sh
# Source-shape checks only. NEVER asserts a native .ores execution.
set -eu
cd "$(dirname "$0")/.."
[ -f ci/native-cases.txt ]
[ "$(grep -c '^[^#].*|browser:' ci/native-cases.txt)" -eq 15 ]
for file in src/isolation/policy.ores src/isolation/site_tenant_policy.ores \
    src/browser/renderer_supervisor.ores src/browser/browser_supervisor.ores \
    src/browser/session_lifecycle.ores src/browser/window_frame_graph.ores src/browser/frame_routing_policy.ores \
    src/browser/tab_epoch.ores \
    src/desktop/tab_policy.ores src/desktop/ui_dispatch_policy.ores \
    src/desktop/tab_session.ores \
    src/desktop/window_tab_strip.ores \
    src/notifications/notification_policy.ores \
    src/workers/service_worker_policy.ores src/workers/lifecycle.ores \
    tests/guest/isolation_policy.ores tests/guest/site_tenant_policy.ores \
    tests/guest/frame_routing_policy.ores \
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
for fn in may_bind_frame_to_renderer may_reuse_renderer_for_frames \
    may_attach_child_frame may_commit_frame_navigation \
    may_route_frame_message may_composite_frame_surface \
    may_retire_unused_renderer; do
  grep -Fq "pub fnc $fn(" src/browser/frame_routing_policy.ores
done
for term in cross-site-postmessage stale-target-document \
    cross-tab-child stale-frame-surface inflight-surface-retirement \
    stale-sender-document stale-sender-process inflight-ipc-retirement; do
  grep -Fq "FAIL:$term" tests/guest/frame_routing_policy.ores
done
grep -Fq 'define actor RendererSupervisorActor' src/browser/renderer_supervisor.ores
grep -Fq 'FAIL:untrusted-hosted-subdomains' tests/guest/site_tenant_policy.ores
grep -Fq 'FAIL:sibling-origin-read' tests/guest/site_tenant_policy.ores
# These source checks are structural only; compilation is a separate gate.
for actor in src/browser/tab_epoch.ores src/browser/browser_supervisor.ores \
    src/browser/session_lifecycle.ores src/browser/window_frame_graph.ores \
    src/browser/renderer_supervisor.ores src/desktop/tab_session.ores \
    src/desktop/window_tab_strip.ores src/workers/lifecycle.ores; do
  [ "$(grep -Ec '^  state \{' "$actor")" -eq 1 ] || {
    echo "INVALID_ACTOR_STATE_SCHEMA: $actor" >&2
    exit 1
  }
  grep -Fq 'self.handle_state(critical |s|' "$actor"
  grep -Fq 'using state.read, state.write {' "$actor" || {
    echo "MISSING_STATE_EFFECT_DECLARATION: $actor" >&2
    exit 1
  }
  if grep -E 'self\.[A-Za-z_][A-Za-z_0-9]*' "$actor" |
       grep -Ev 'self\.(send|end|handle_state|handle_operation|apply_epoch)\('; then
    echo "DIRECT_ACTOR_FIELD_ACCESS: $actor" >&2
    exit 1
  fi
  if grep -Eq 'self\.[A-Za-z_][A-Za-z_0-9]*[[:space:]]*=' "$actor"; then
    echo "DIRECT_ACTOR_FIELD_WRITE: $actor" >&2
    exit 1
  fi
done
grep -Fq 'FAIL:stale-child-surface' src/browser/window_frame_graph.ores
grep -Fq 'FAIL:cross-tab-damage' src/browser/window_frame_graph.ores
grep -Fq 'FAIL:stale-tab-id' src/browser/browser_supervisor.ores
grep -Fq 'FAIL:stale-session-close' src/browser/session_lifecycle.ores
grep -Fq 'FAIL:cross-session-retirement' src/browser/session_lifecycle.ores
grep -Fq 'FAIL:recycled-session-generation' src/browser/session_lifecycle.ores
grep -Fq 'FAIL:nonrecycled-tab-id' src/browser/browser_supervisor.ores
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
