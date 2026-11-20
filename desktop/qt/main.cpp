#include "UiBridge.h"
#include <QGuiApplication>
#include <QQmlApplicationEngine>
#include <QtQml/qqml.h>
#include <QCoreApplication>

int main(int argc, char **argv) {
    QGuiApplication app(argc, argv);
    QCoreApplication::setOrganizationName(QStringLiteral("Oreslang"));
    QCoreApplication::setApplicationName(QStringLiteral("OresBrowser"));

    UiBridge bridge;
    qmlRegisterSingletonInstance("OresBrowser.Runtime", 1, 0,
                                 "BrowserBackend", &bridge);
    QQmlApplicationEngine engine;
    QObject::connect(&engine, &QQmlApplicationEngine::objectCreationFailed,
                     &app, []() { QCoreApplication::exit(1); },
                     Qt::QueuedConnection);
    engine.loadFromModule("OresBrowser", "Main");
    bridge.start();
    return app.exec();
}
