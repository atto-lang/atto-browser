// Real Qt 6 queued-event-loop test of the production revision credit gate.
// This deliberately uses NO mock Oreslang browser backend and cannot prove
// guest execution, renderer isolation, or actual UiBridge FFI behavior.
#include "ores_browser_snapshot_queue_v1.h"
#include <QCoreApplication>
#include <QMetaObject>
#include <QObject>
#include <QThread>
#include <QTimer>
#include <atomic>
#include <cstdio>
#include <cstdlib>

int main(int argc, char **argv) {
    QCoreApplication app(argc, argv);
    QObject ui;
    QThread worker_thread;
    QObject *worker = new QObject;
    worker->moveToThread(&worker_thread);
    QObject::connect(&worker_thread, &QThread::finished,
                     worker, &QObject::deleteLater);
    worker_thread.start();

    // Only callbacks on worker_thread may touch the non-atomic gate.
    OresBrowserSnapshotQueueV1 credit;
    std::atomic<unsigned> emitted{0}, rejected{0}, errors{0};
    bool completed = false;

    const bool admitted = QMetaObject::invokeMethod(worker, [&] {
        if (!credit.tryReserve(7u)) ++errors;
        if (credit.acknowledge(8u)) ++errors; // wrong revision
        if (credit.acknowledge(0u)) ++errors;
        ++emitted;
        for (unsigned i = 0; i < 100000u; ++i) {
            if (credit.tryReserve(8u)) ++errors;
            else ++rejected;
        }
        // A blocked UI can receive only the one queued snapshot. There is
        // no second event until UI delivery and a revision-matched ACK.
        if (!QMetaObject::invokeMethod(&ui, [&] {
            if (emitted.load() != 1u || rejected.load() != 100000u) ++errors;
            if (!QMetaObject::invokeMethod(worker, [&] {
                if (!credit.acknowledge(7u)) ++errors;
                if (credit.acknowledge(7u)) ++errors; // replay
                if (!credit.tryReserve(8u)) ++errors;
                ++emitted;
                if (!QMetaObject::invokeMethod(&ui, [&] {
                    if (emitted.load() != 2u) ++errors;
                    if (!QMetaObject::invokeMethod(worker, [&] {
                        if (credit.acknowledge(7u)) ++errors; // stale ACK
                        if (!credit.acknowledge(8u)) ++errors;
                        if (credit.pending()) ++errors;
                        if (!QMetaObject::invokeMethod(&app, [&] {
                            completed = true;
                            app.quit();
                        }, Qt::QueuedConnection)) ++errors;
                    }, Qt::QueuedConnection)) ++errors;
                }, Qt::QueuedConnection)) ++errors;
            }, Qt::QueuedConnection)) ++errors;
        }, Qt::QueuedConnection)) ++errors;
    }, Qt::QueuedConnection);

    // Deliberately delay GUI delivery, while the worker is free to churn.
    QThread::msleep(150);
    QTimer::singleShot(5000, &app, &QCoreApplication::quit);
    const int event_result = admitted ? app.exec() : 2;
    worker_thread.quit();
    if (!worker_thread.wait(2500)) {
        std::fputs("QT_SNAPSHOT_ACK_THREAD_TIMEOUT\n", stderr);
        std::_Exit(70);
    }
    if (event_result != 0 || !completed || emitted != 2u ||
        rejected != 100000u || errors != 0u) {
        std::fprintf(stderr, "QT_SNAPSHOT_ACK_FAIL emitted=%u rejected=%u errors=%u completed=%d\n",
                     emitted.load(), rejected.load(), errors.load(), completed ? 1 : 0);
        return 1;
    }
    std::puts("QT_SNAPSHOT_ACK_EVENT_LOOP_PASS (host transport only, NOT browser backend)");
    return 0;
}
