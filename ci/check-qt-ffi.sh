#!/bin/sh
# Compiles and executes portable C/C++ ABI probes; NOT a Qt build or Oreslang guest run.
set -eu
cd "$(dirname "$0")/.."
command -v cc >/dev/null 2>&1 || { echo "NO_C_COMPILER" >&2; exit 1; }
command -v c++ >/dev/null 2>&1 || { echo "NO_CPP_COMPILER" >&2; exit 1; }
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
cc -std=c11 -Wall -Wextra -Werror -pedantic \
  -I include tests/abi/header_smoke.c -o "$tmp/abi-c"
c++ -std=c++17 -Wall -Wextra -Werror -pedantic \
  -I include tests/abi/header_smoke.cpp -o "$tmp/abi-cpp"
"$tmp/abi-c"
"$tmp/abi-cpp"
cc -std=c11 -Wall -Wextra -Werror -pedantic \
  -I include tests/abi/wire_adversarial.c -o "$tmp/abi-wire"
"$tmp/abi-wire"
# Always-on Release-mode anti-spoofing gate: all 65536 UTF-16 code units.
# This is a portable host contract test, not a compiled Qt event loop.
cc -std=c11 -O2 -DNDEBUG -Wall -Wextra -Werror -pedantic \
  -I include tests/abi/chrome_control_matrix.c -o "$tmp/chrome-text"
"$tmp/chrome-text"
# The exact same anti-spoofing policy header also compiles as C++17,
# as used by the Qt bridge. Do not silently rely on C-only extensions.
c++ -x c++ -std=c++17 -O2 -DNDEBUG -Wall -Wextra -Werror -pedantic \
  -I include tests/abi/chrome_control_matrix.c -o "$tmp/chrome-text-cpp"
"$tmp/chrome-text-cpp"
if command -v clang >/dev/null 2>&1; then
  clang -std=c11 -O1 -g -DNDEBUG -Wall -Wextra -Werror -pedantic \
    -fsanitize=address,undefined -fno-omit-frame-pointer \
    -I include tests/abi/chrome_control_matrix.c -o "$tmp/chrome-text-sanitize"
  "$tmp/chrome-text-sanitize"
fi
# Execute the same UI-thread-only limiter used by the Qt bridge. This checks
# saturation, non-wrapping counts, draining and one-outstanding UI snapshot,
# not Qt event-loop delivery behavior.
c++ -std=c++17 -O2 -DNDEBUG -Wall -Wextra -Werror -pedantic \
  -I include tests/abi/ui_queue_admission.cpp -o "$tmp/ui-queue"
"$tmp/ui-queue"
# Revision-fenced worker-to-UI snapshot credit / replay refusal (host-only).
c++ -std=c++17 -O2 -DNDEBUG -Wall -Wextra -Werror -pedantic \
  -I include tests/abi/snapshot_queue_admission.cpp -o "$tmp/snapshot-queue"
"$tmp/snapshot-queue"
# If Clang is present, also execute the identical byte-boundary matrix under
# memory and undefined-behavior sanitizers; a sanitizer failure is fatal.
if command -v clang++ >/dev/null 2>&1; then
  clang++ -std=c++17 -O1 -g -DNDEBUG -Wall -Wextra -Werror -pedantic \
    -fsanitize=address,undefined -fno-omit-frame-pointer \
    -I include tests/abi/ui_queue_admission.cpp -o "$tmp/ui-queue-sanitize"
  "$tmp/ui-queue-sanitize"
  clang++ -std=c++17 -O1 -g -DNDEBUG -Wall -Wextra -Werror -pedantic \
    -fsanitize=address,undefined -fno-omit-frame-pointer \
    -I include tests/abi/snapshot_queue_admission.cpp -o "$tmp/snapshot-queue-sanitize"
  "$tmp/snapshot-queue-sanitize"
fi
# Compile/link integration acceptance, but NEVER run without pinned real
# Oreslang backend and the separate ci/verify-backend-ffi.sh gate.
cc -std=c11 -Wall -Wextra -Werror -pedantic \
  -I include tests/abi/backend_integration.c -ldl -o "$tmp/backend-ffi"
echo "ABI_LAYOUT_WIRE_UI_QUEUE_AND_REVISION_SNAPSHOT_EXECUTED; BACKEND_PROBE_COMPILED_ONLY"
for file in desktop/qt/main.cpp desktop/qt/UiBridge.h \
    desktop/qt/UiBridge.cpp desktop/qt/Main.qml \
    desktop/qt/CMakeLists.txt include/ores_browser_ui_abi_v1.h; do
  test -f "$file"
done
grep -Fq 'qmlRegisterSingletonInstance(' desktop/qt/main.cpp
grep -Fq 'qt_add_qml_module(' desktop/qt/CMakeLists.txt
grep -Fq 'qt_snapshot_ack_event_loop' desktop/qt/CMakeLists.txt
grep -Fq 'Qt::QueuedConnection' desktop/qt/UiBridge.cpp
grep -Fq 'ores_browser_abi_version' desktop/qt/UiBridge.cpp
grep -Fq 'No WebEngine/QtWebView' desktop/qt/CMakeLists.txt
grep -Fq 'ores_browser_validate_snapshot_v1' desktop/qt/UiBridge.cpp
grep -Fq 'ores_browser_validate_command_v1' desktop/qt/UiBridge.cpp
grep -Fq 'ores_browser_validate_config_v1(&config)' desktop/qt/UiBridge.cpp
grep -Fq 'submit(ORES_BROWSER_CMD_NEXT_TAB);' desktop/qt/UiBridge.cpp
grep -Fq 'submit(ORES_BROWSER_CMD_PREVIOUS_TAB);' desktop/qt/UiBridge.cpp
grep -Fq 'Snapshot changed without revision increment' desktop/qt/UiBridge.cpp
grep -Fq 'libraryFile.isSymLink()' desktop/qt/UiBridge.cpp
grep -Fq 'std::_Exit(70)' desktop/qt/UiBridge.cpp
grep -Fq 'command_queue_.tryReserve()' desktop/qt/UiBridge.cpp
grep -Fq 'OresBrowserUiQueueV1::captureFits' desktop/qt/UiBridge.cpp
grep -Fq 'ores_browser_chrome_disallowed_v1(u)' desktop/qt/UiBridge.cpp
test -f include/ores_browser_chrome_text_v1.h
test -f tests/abi/chrome_control_matrix.c
grep -Fq 'commandCompleted' desktop/qt/UiBridge.cpp
grep -Fq 'snapshot_queue_.pending()' desktop/qt/UiBridge.cpp
grep -Fq 'snapshot_queue_.tryReserve(last_revision_)' desktop/qt/UiBridge.cpp
grep -Fq 'snapshot_queue_.acknowledge(revision)' desktop/qt/UiBridge.cpp
grep -Fq 'worker->acknowledgeSnapshot(revision)' desktop/qt/UiBridge.cpp
grep -Fq 'textFormat: Text.PlainText' desktop/qt/Main.qml
if grep -Eiq '(WebEngineView|import QtWebEngine|QtWebView|WKWebView|WebView2|Electron)' desktop/qt/Main.qml; then
  echo "FORBIDDEN_EMBEDDED_WEBVIEW" >&2
  exit 1
fi
echo "QT_FFI_ABI_HOST_PASS (C and C++ executed; NOT Qt build or Oreslang execution)"
