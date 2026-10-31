cmake_minimum_required(VERSION 3.21)
project(OreslangBrowserDesktop LANGUAGES CXX)
include(CTest)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)
find_package(Qt6 6.5 REQUIRED COMPONENTS Quick Qml QuickControls2)
qt_standard_project_setup(REQUIRES 6.5)

qt_add_executable(ores-browser
    main.cpp
    UiBridge.cpp
    UiBridge.h
)
qt_add_qml_module(ores-browser
    URI OresBrowser
    VERSION 1.0
    QML_FILES Main.qml
)
target_include_directories(ores-browser PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/../../include)
target_link_libraries(ores-browser PRIVATE
    Qt6::Quick Qt6::Qml Qt6::QuickControls2)
# No WebEngine/QtWebView or alternative browser backend dependency.
# Runtime backend is loaded ONLY from the application directory by UiBridge.

# Opt-in through BUILD_TESTING; this executes a real Qt 6 event loop.
# The test refuses unexpected adjacent backend libraries, requires fail-closed
# startup with a missing AOT backend, and does not simulate any guest behavior.
if(BUILD_TESTING AND NOT CMAKE_CROSSCOMPILING)
    qt_add_executable(ores-browser-offline-smoke
        tests/offline_shell_smoke.cpp
        UiBridge.cpp
        UiBridge.h
    )
    set_target_properties(ores-browser-offline-smoke PROPERTIES
        RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}/offline-smoke")
    target_include_directories(ores-browser-offline-smoke PRIVATE
        ${CMAKE_CURRENT_SOURCE_DIR}/../../include)
    target_link_libraries(ores-browser-offline-smoke PRIVATE
        Qt6::Quick Qt6::Qml Qt6::QuickControls2)
    add_test(NAME qt_gui_backend_absent_fail_closed
        COMMAND ores-browser-offline-smoke)
    set_tests_properties(qt_gui_backend_absent_fail_closed PROPERTIES
        TIMEOUT 12
        ENVIRONMENT "QT_QPA_PLATFORM=offscreen")
endif()
