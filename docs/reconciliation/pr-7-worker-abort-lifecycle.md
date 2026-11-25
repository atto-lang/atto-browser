# PR #7 — Worker cancellation semantic reconciliation

Historical head a1a6287d7871fb3e93fddfcd0807232fcfd0f5e7; current main 3e9bf6686fb6a691148f99b9eaa3e462bf9153f2.

Current `src/worker-host.mjs` already contains pre-abort denial, factory-time abort fencing, in-flight abort cleanup, deadline and error cleanup, listener removal, exactly-once termination, manifest cloning, and bounded input rejection. Current `tests/worker-host.test.mjs` has all eleven historical test cases **plus** the oversized-module denial case, with an additional factory-abort adversarial test from #5. Retain these newer files as authoritative rather than restoring the old worker host or losing its byte budget and synchronous race protections.

No unported core feature was identified in the historical three-file diff. A resolved Git branch does not prove a real browser run. Exact-head Node 22 and Chromium/Firefox worker tests, including termination and abort races, remain acceptance gates. This is a historical supersession, **not** a new feature certification or a source-language actor implementation.