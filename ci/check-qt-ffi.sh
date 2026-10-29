#!/bin/sh
# C/C++ syntax-only, not a Qt build and NOT a native Oreslang guest run.
set -eu
cd "$(dirname "$0")/.."
command -v cc >/dev/null 2>&1 || { echo "NO_C_COMPILER" >&2; exit 1; }
command -v c++ >/dev/null 2>&1 || { echo "NO_CPP_COMPILER" >&2; exit 1; }
cc -std=c11 -Wall -Wextra -Werror -pedantic -fsyntax-only \
  -I include tests/abi/header_smoke.c
c++ -std=c++17 -Wall -Wextra -Werror -pedantic -fsyntax-only \
  -I include tests/abi/header_smoke.cpp
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
if grep -Eiq '(WebEngineView|import QtWebEngine|QtWebView|WKWebView|WebView2|Electron)' desktop/qt/Main.qml; then
  echo "FORBIDDEN_EMBEDDED_WEBVIEW" >&2
  exit 1
fi
echo "QT_FFI_ABI_SOURCE_PASS (NOT Qt build, not Oreslang execution)"
