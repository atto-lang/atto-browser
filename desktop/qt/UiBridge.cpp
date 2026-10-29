#include "UiBridge.h"
#include <QCoreApplication>
#include <QDir>
#include <QMetaObject>
#include <QVariantMap>
#include <QByteArray>
#include <QSet>
#include <cstring>
#include <limits>
#include <memory>

namespace {
template <size_t N>
bool checkedUtf8(const char (&bytes)[N], QString &target) {
    size_t count = 0;
    while (count < N && bytes[count] != '\0') ++count;
    if (count == N) return false;
    // Fixed-width ABI strings must have canonical zero-padding.
    for (size_t i = count + 1; i < N; ++i) {
        if (bytes[i] != '\0') return false;
    }
    const QByteArray original(bytes, static_cast<int>(count));
    target = QString::fromUtf8(original.constData(),
                               static_cast<qsizetype>(original.size()));
    // Roundtrip rejects malformed UTF-8 but accepts valid U+FFFD.
    return target.toUtf8() == original;
}
bool validStatus(int32_t status) {
    return status >= ORES_BROWSER_OK && status <= ORES_BROWSER_INTERNAL;
}
} // namespace

void BackendWorker::start() {
    if (handle_ || lib_) return;
    // The release packager must code-sign this *app-bundled* library.
    // No current-working-directory, environment or user-supplied DLL paths.
    lib_ = std::make_unique<QLibrary>(
        QDir(QCoreApplication::applicationDirPath())
            .absoluteFilePath(QStringLiteral("ores_browser_backend")));
    if (!lib_->load()) {
        failClosed(QStringLiteral("Oreslang backend library unavailable. "
                                  "Desktop shell is offline; no C++ fallback."));
        return;
    }
    abi_ = reinterpret_cast<decltype(abi_)>(lib_->resolve("ores_browser_abi_version"));
    open_ = reinterpret_cast<decltype(open_)>(lib_->resolve("ores_browser_open"));
    dispatch_ = reinterpret_cast<decltype(dispatch_)>(lib_->resolve("ores_browser_dispatch"));
    snapshot_ = reinterpret_cast<decltype(snapshot_)>(lib_->resolve("ores_browser_snapshot"));
    close_ = reinterpret_cast<decltype(close_)>(lib_->resolve("ores_browser_close"));
    if (!abi_ || !open_ || !dispatch_ || !snapshot_ || !close_ ||
        abi_() != ORES_BROWSER_UI_ABI_VERSION) {
        failClosed(QStringLiteral("Oreslang UI ABI v1 mismatch or missing exports"));
        return;
    }
    OresBrowserConfig config{};
    config.struct_size = sizeof(config);
    config.abi_version = ORES_BROWSER_UI_ABI_VERSION;
    // Privileged Oreslang supervisor chooses tenant and profile.
    config.private_session = 0;
    const int32_t status = open_(&config, &handle_);
    if (status != ORES_BROWSER_OK || !handle_) {
        failClosed(QStringLiteral("Oreslang supervisor refused startup"));
        return;
    }
    readSnapshot();
    if (!handle_) return; // readSnapshot may have failed closed
    poll_ = new QTimer(this);
    poll_->setInterval(250);
    connect(poll_, &QTimer::timeout, this, &BackendWorker::readSnapshot);
    poll_->start();
}

void BackendWorker::failClosed(const QString &message) {
    shutdown();
    emit fatal(message);
}
void BackendWorker::shutdown() {
    if (poll_) { poll_->stop(); delete poll_; poll_ = nullptr; }
    if (handle_ && close_) close_(handle_);
    handle_ = nullptr;
    abi_ = nullptr;
    open_ = nullptr;
    dispatch_ = nullptr;
    snapshot_ = nullptr;
    close_ = nullptr;
    if (lib_) { lib_->unload(); lib_.reset(); }
}
void BackendWorker::submit(uint32_t op, const QString &id,
                           const QString &generation, const QString &url) {
    if (!handle_ || !dispatch_) {
        emit rejected(QStringLiteral("Oreslang backend offline"));
        return;
    }
    if (op < ORES_BROWSER_CMD_NEW_TAB || op > ORES_BROWSER_CMD_PREVIOUS_TAB) {
        emit rejected(QStringLiteral("Unsupported UI command"));
        return;
    }
    OresBrowserCommand command{};
    command.struct_size = sizeof(command);
    command.operation = op;
    if (op != ORES_BROWSER_CMD_NEW_TAB) {
        bool id_ok = false, gen_ok = false;
        command.tab_id = id.toULongLong(&id_ok, 10);
        command.tab_generation = generation.toULongLong(&gen_ok, 10);
        if (!id_ok || !gen_ok || !command.tab_id || !command.tab_generation) {
            emit rejected(QStringLiteral("Stale or invalid tab identity"));
            return;
        }
    }
    if (op == ORES_BROWSER_CMD_NAVIGATE) {
        const QByteArray value = url.toUtf8();
        if (value.isEmpty() || value.size() >= ORES_BROWSER_URL_BYTES ||
            value.contains('\0') || QString::fromUtf8(value) != url) {
            emit rejected(QStringLiteral("Invalid address length or encoding"));
            return;
        }
        std::memcpy(command.url, value.constData(), size_t(value.size()));
        command.url[value.size()] = '\0';
    }
    const int32_t status = dispatch_(handle_, &command);
    if (!validStatus(status)) {
        failClosed(QStringLiteral("Invalid Oreslang command status"));
        return;
    }
    if (status != ORES_BROWSER_OK) {
        emit rejected(QStringLiteral("Oreslang backend rejected command (%1)")
                          .arg(status));
    }
    readSnapshot(); // Backend, not Qt, determines the resulting state.
}
void BackendWorker::readSnapshot() {
    if (!handle_ || !snapshot_) return;
    auto view = std::make_unique<OresBrowserSnapshot>();
    view->struct_size = sizeof(*view);
    view->abi_version = ORES_BROWSER_UI_ABI_VERSION;
    const int32_t status = snapshot_(handle_, view.get());
    if (status != ORES_BROWSER_OK ||
        view->struct_size != sizeof(*view) ||
        view->abi_version != ORES_BROWSER_UI_ABI_VERSION ||
        view->tab_count > ORES_BROWSER_MAX_TABS ||
        view->reserved != 0 ||
        (have_revision_ && view->revision < last_revision_)) {
        failClosed(QStringLiteral("Invalid Oreslang backend snapshot"));
        return;
    }
    if (have_revision_ && last_revision_ == view->revision) return;
    QVariantList tabs;
    QString activeId, activeGeneration, activeUrl;
    bool canBack = false, canForward = false;
    uint32_t activeCount = 0;
    QSet<quint64> seenTabIds;
    for (uint32_t i = 0; i < view->tab_count; ++i) {
        const auto &t = view->tabs[i];
        if (!t.tab_id || !t.generation || t.active > 1 ||
            t.can_go_back > 1 || t.can_go_forward > 1 || t.loading > 1) {
            failClosed(QStringLiteral("Malformed tab record")); return;
        }
        if (seenTabIds.contains(t.tab_id)) {
            failClosed(QStringLiteral("Duplicate live tab identity")); return;
        }
        seenTabIds.insert(t.tab_id);
        QString title, displayUrl;
        if (!checkedUtf8(t.title, title) ||
            !checkedUtf8(t.display_url, displayUrl)) {
            failClosed(QStringLiteral("Malformed tab string")); return;
        }
        QVariantMap record;
        const QString tabId = QString::number(t.tab_id);
        const QString generation = QString::number(t.generation);
        record.insert(QStringLiteral("id"), tabId);
        record.insert(QStringLiteral("generation"), generation);
        record.insert(QStringLiteral("title"), title);
        record.insert(QStringLiteral("url"), displayUrl);
        record.insert(QStringLiteral("active"), t.active != 0);
        record.insert(QStringLiteral("loading"), t.loading != 0);
        tabs.append(record);
        if (t.active) {
            ++activeCount;
            activeId = tabId;
            activeGeneration = generation;
            activeUrl = displayUrl;
            canBack = t.can_go_back != 0;
            canForward = t.can_go_forward != 0;
        }
    }
    if (activeCount > 1 || (view->tab_count > 0 && activeCount != 1)) {
        failClosed(QStringLiteral("Invalid selected-tab count")); return;
    }
    last_revision_ = view->revision;
    have_revision_ = true;
    emit ready(tabs, activeId, activeGeneration, activeUrl, canBack, canForward);
}

UiBridge::UiBridge(QObject *parent) : QObject(parent) {}
UiBridge::~UiBridge() {
    if (!worker_) return;
    if (thread_.isRunning()) {
        auto *worker = worker_;
        QMetaObject::invokeMethod(worker, [worker] { worker->shutdown(); },
                                  Qt::BlockingQueuedConnection);
        thread_.quit();
        thread_.wait();
    }
}
void UiBridge::start() {
    if (worker_) return;
    worker_ = new BackendWorker;
    worker_->moveToThread(&thread_);
    connect(&thread_, &QThread::finished, worker_, &QObject::deleteLater);
    connect(worker_, &BackendWorker::ready, this,
            [this](const QVariantList &tabs, const QString &id,
                   const QString &generation, const QString &url,
                   bool back, bool forward) {
        tabs_ = tabs;
        activeId_ = id;
        activeGeneration_ = generation;
        activeUrl_ = url;
        canBack_ = back;
        canForward_ = forward;
        if (!connected_) { connected_ = true; emit connectedChanged(); }
        status_ = QStringLiteral("Connected to Oreslang backend");
        emit statusChanged();
        emit viewChanged();
    });
    connect(worker_, &BackendWorker::rejected, this,
            [this](const QString &message) {
        status_ = message;
        emit statusChanged();
    });
    connect(worker_, &BackendWorker::fatal, this,
            [this](const QString &message) {
        connected_ = false;
        tabs_.clear();
        activeId_.clear();
        activeGeneration_.clear();
        activeUrl_.clear();
        canBack_ = canForward_ = false;
        status_ = message;
        emit connectedChanged();
        emit viewChanged();
        emit statusChanged();
    });
    thread_.start();
    auto *worker = worker_;
    QMetaObject::invokeMethod(worker, [worker] { worker->start(); },
                              Qt::QueuedConnection);
}
void UiBridge::submit(uint32_t op, const QString &id,
                      const QString &generation, const QString &url) {
    if (!worker_ || !connected_) return;
    auto *worker = worker_;
    QMetaObject::invokeMethod(worker, [worker, op, id, generation, url] {
        worker->submit(op, id, generation, url);
    }, Qt::QueuedConnection);
}
void UiBridge::newTab() { submit(ORES_BROWSER_CMD_NEW_TAB); }
void UiBridge::selectTab(const QString &id, const QString &generation) {
    submit(ORES_BROWSER_CMD_SELECT_TAB, id, generation);
}
void UiBridge::closeTab(const QString &id, const QString &generation) {
    submit(ORES_BROWSER_CMD_CLOSE_TAB, id, generation);
}
void UiBridge::navigate(const QString &url) {
    if (activeId_.isEmpty()) return;
    submit(ORES_BROWSER_CMD_NAVIGATE, activeId_, activeGeneration_, url);
}
void UiBridge::goBack() {
    if (canBack_) submit(ORES_BROWSER_CMD_BACK, activeId_, activeGeneration_);
}
void UiBridge::goForward() {
    if (canForward_) submit(ORES_BROWSER_CMD_FORWARD, activeId_, activeGeneration_);
}
void UiBridge::reload() {
    if (!activeId_.isEmpty())
        submit(ORES_BROWSER_CMD_RELOAD, activeId_, activeGeneration_);
}
void UiBridge::nextTab() {
    if (!activeId_.isEmpty())
        submit(ORES_BROWSER_CMD_NEXT_TAB, activeId_, activeGeneration_);
}
void UiBridge::previousTab() {
    if (!activeId_.isEmpty())
        submit(ORES_BROWSER_CMD_PREVIOUS_TAB, activeId_, activeGeneration_);
}
