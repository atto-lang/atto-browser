cmake_minimum_required(VERSION 3.21)
project(OreslangBrowserDesktop LANGUAGES CXX)
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
