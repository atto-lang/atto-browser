#pragma once
#include <QObject>
#include <QThread>
#include <QVariantList>
#include <QLibrary>
#include <QString>
#include <QTimer>
#include <QByteArray>
#include <memory>
#include "ores_browser_ui_abi_v1.h"
#include "ores_browser_ui_queue_v1.h"

// QML -> UI bridge -> dedicated FFI thread -> Oreslang AOT library.
// QObject classes expose UI state ONLY; they do not own browser state.
class BackendWorker final : public QObject {
    Q_OBJECT
public:
    explicit BackendWorker(QObject *parent = nullptr) : QObject(parent) {}
public slots:
    void start();
    void submit(uint32_t operation, const QString &id,
                const QString &generation, const QString &url);
    void shutdown();
    void acknowledgeSnapshot();
signals:
    void ready(const QVariantList &tabs, const QString &activeId,
               const QString &activeGeneration, const QString &activeUrl,
               bool back, bool forward);
    void fatal(const QString &why);
    void rejected(const QString &why);
    void commandCompleted();
private:
    void readSnapshot();
    void failClosed(const QString &message);
    std::unique_ptr<QLibrary> lib_;
    QTimer *poll_ = nullptr;
    OresBrowserViewGateV1 view_gate_;
    OresBrowserHandle *handle_ = nullptr;
    uint64_t last_revision_ = 0;
    bool have_revision_ = false;
    QByteArray last_wire_;
    uint32_t (*abi_)() = nullptr;
    int32_t (*open_)(const OresBrowserConfig*, OresBrowserHandle**) = nullptr;
    int32_t (*dispatch_)(OresBrowserHandle*, const OresBrowserCommand*) = nullptr;
    int32_t (*snapshot_)(OresBrowserHandle*, OresBrowserSnapshot*) = nullptr;
    void (*close_)(OresBrowserHandle*) = nullptr;
};

class UiBridge final : public QObject {
    Q_OBJECT
    Q_PROPERTY(QVariantList tabs READ tabs NOTIFY viewChanged)
    Q_PROPERTY(QString activeTabId READ activeTabId NOTIFY viewChanged)
    Q_PROPERTY(QString activeTabGeneration READ activeTabGeneration NOTIFY viewChanged)
    Q_PROPERTY(QString activeUrl READ activeUrl NOTIFY viewChanged)
    Q_PROPERTY(bool canGoBack READ canGoBack NOTIFY viewChanged)
    Q_PROPERTY(bool canGoForward READ canGoForward NOTIFY viewChanged)
    Q_PROPERTY(bool connected READ connected NOTIFY connectedChanged)
    Q_PROPERTY(QString statusMessage READ statusMessage NOTIFY statusChanged)
public:
    explicit UiBridge(QObject *parent = nullptr);
    ~UiBridge() override;
    void start();
    QVariantList tabs() const { return tabs_; }
    QString activeTabId() const { return activeId_; }
    QString activeTabGeneration() const { return activeGeneration_; }
    QString activeUrl() const { return activeUrl_; }
    bool canGoBack() const { return canBack_; }
    bool canGoForward() const { return canForward_; }
    bool connected() const { return connected_; }
    QString statusMessage() const { return status_; }

    Q_INVOKABLE void newTab();
    Q_INVOKABLE void selectTab(const QString &id, const QString &generation);
    Q_INVOKABLE void closeTab(const QString &id, const QString &generation);
    Q_INVOKABLE void navigate(const QString &url);
    Q_INVOKABLE void goBack();
    Q_INVOKABLE void goForward();
    Q_INVOKABLE void reload();
    Q_INVOKABLE void nextTab();
    Q_INVOKABLE void previousTab();
signals:
    void viewChanged();
    void connectedChanged();
    void statusChanged();
private:
    void submit(uint32_t op, const QString &id = {},
                const QString &generation = {}, const QString &url = {});
    QThread thread_;
    BackendWorker *worker_ = nullptr;
    OresBrowserUiQueueV1 command_queue_;
    QVariantList tabs_;
    QString activeId_;
    QString activeGeneration_;
    QString activeUrl_;
    bool canBack_ = false;
    bool canForward_ = false;
    bool connected_ = false;
    QString status_ = QStringLiteral("Waiting for Oreslang AOT backend");
};
