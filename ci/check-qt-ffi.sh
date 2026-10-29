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
echo "ABI_LAYOUT_AND_WIRE_ADVERSARIAL_EXECUTED"
for file in desktop/qt/main.cpp desktop/qt/UiBridge.h \
    desktop/qt/UiBridge.cpp desktop/qt/Main.qml \
    desktop/qt/CMakeLists.txt include/ores_browser_ui_abi_v1.h; do
  test -f "$file"
done
grep -Fq 'qmlRegisterSingletonInstance(' desktop/qt/main.cpp
grep -Fq 'qt_add_qml_module(' desktop/qt/CMakeLists.txt
grep -Fq 'Qt::QueuedConnection' desktop/qt/UiBridge.cpp
grep -Fq 'ores_browser_abi_version' desktop/qt/UiBridge.cpp
grep -Fq 'No WebEngine/QtWebView' desktop/qt/CMakeLists.txt
grep -Fq 'ores_browser_validate_snapshot_v1' desktop/qt/UiBridge.cpp
grep -Fq 'ores_browser_validate_command_v1' desktop/qt/UiBridge.cpp
grep -Fq 'Snapshot changed without revision increment' desktop/qt/UiBridge.cpp
grep -Fq 'libraryFile.isSymLink()' desktop/qt/UiBridge.cpp
grep -Fq 'std::_Exit(70)' desktop/qt/UiBridge.cpp
grep -Fq 'textFormat: Text.PlainText' desktop/qt/Main.qml
if grep -Eiq '(WebEngineView|import QtWebEngine|QtWebView|WKWebView|WebView2|Electron)' desktop/qt/Main.qml; then
  echo "FORBIDDEN_EMBEDDED_WEBVIEW" >&2
  exit 1
fi
echo "QT_FFI_ABI_HOST_PASS (C and C++ executed; NOT Qt build or Oreslang execution)"
