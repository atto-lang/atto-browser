// Real Qt event-loop fail-closed smoke. No mock Oreslang backend and
// no claim of native guest execution or renderer sandboxing.
#include "../UiBridge.h"
#include <QCoreApplication>
#include <QDir>
#include <QFileInfo>
#include <QGuiApplication>
#include <QTimer>
#include <cstdio>

int main(int argc, char **argv) {
    QGuiApplication app(argc, argv);
#if defined(Q_OS_WIN)
    const QString library = QStringLiteral("ores_browser_backend.dll");
#elif defined(Q_OS_MACOS)
    const QString library = QStringLiteral("libores_browser_backend.dylib");
#else
    const QString library = QStringLiteral("libores_browser_backend.so");
#endif
    // Test binary lives in a dedicated build subdirectory. Never call an
    // unexpected backend during this source-only/offline acceptance test.
    const QFileInfo probe(QDir(QCoreApplication::applicationDirPath()).filePath(library));
    if (probe.exists() || probe.isSymLink()) {
        std::fputs("OFFLINE_QT_SMOKE_INVALID: backend unexpectedly adjacent to test executable\n", stderr);
        return 2;
    }

    bool offline = false;
    bool connected = false;
    UiBridge bridge;
    QObject::connect(&bridge, &UiBridge::connectedChanged, &app,
                     [&] { connected = connected || bridge.connected(); });
    QObject::connect(&bridge, &UiBridge::statusChanged, &app, [&] {
        if (bridge.statusMessage() ==
            QStringLiteral("Packaged Oreslang backend missing or unsafe path")) {
            offline = true;
            app.quit();
        }
    });
    // Never block the CI process if a worker thread cannot initialize.
    QTimer::singleShot(6000, &app, &QCoreApplication::quit);
    bridge.start();
    bridge.newTab(); // cannot dispatch a command before backend admission
    const int status = app.exec();
    if (status != 0 || connected || !offline || bridge.connected() ||
        !bridge.tabs().isEmpty()) {
        std::fputs("OFFLINE_QT_SMOKE_FAIL: shell did not refuse missing native backend\n", stderr);
        return 1;
    }
    std::puts("QT_OFFSCREEN_BACKEND_ABSENT_FAIL_CLOSED_PASS (not Oreslang execution)");
    return 0;
}
