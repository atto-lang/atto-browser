import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import OresBrowser.Runtime 1.0

ApplicationWindow {
    id: appWindow
    visible: true
    width: 1200
    height: 760
    minimumWidth: 750
    minimumHeight: 480
    title: "Oreslang Browser — Native Qt shell"
    color: "#121a28"

    Shortcut {
        sequences: ["Ctrl+T", "Meta+T"]
        enabled: BrowserBackend.connected
        onActivated: BrowserBackend.newTab()
    }
    Shortcut {
        sequences: ["Ctrl+W", "Meta+W"]
        enabled: BrowserBackend.connected && BrowserBackend.activeTabId.length > 0
        onActivated: BrowserBackend.closeTab(BrowserBackend.activeTabId,
                                             BrowserBackend.activeTabGeneration)
    }
    Shortcut {
        sequences: ["Ctrl+L", "Meta+L"]
        onActivated: { address.forceActiveFocus(); address.selectAll() }
    }
    Shortcut {
        sequence: "Ctrl+Tab"
        enabled: BrowserBackend.connected && BrowserBackend.tabs.length > 1
        onActivated: BrowserBackend.nextTab()
    }

    Shortcut {
        sequence: "Ctrl+Shift+Tab"
        enabled: BrowserBackend.connected && BrowserBackend.tabs.length > 1
        onActivated: BrowserBackend.previousTab()
    }

    ColumnLayout {
        anchors.fill: parent
        spacing: 0
        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: 49
            color: "#1c2a3d"
            RowLayout {
                anchors.fill: parent
                anchors.leftMargin: 13
                anchors.rightMargin: 13
                spacing: 9
                Label {
                    text: "◈  Oreslang"
                    color: "#dbeafe"
                    font.bold: true
                    font.pixelSize: 18
                }
                Label {
                    text: "Browser"
                    color: "#9fb1c8"
                    font.pixelSize: 13
                }
                Item { Layout.fillWidth: true }
                Label {
                    text: BrowserBackend.connected ? "Oreslang backend connected"
                                                   : "Backend unavailable"
                    color: BrowserBackend.connected ? "#86efac" : "#fca5a5"
                }
            }
        }
        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: 49
            color: "#202f44"
            RowLayout {
                anchors.fill: parent
                anchors.leftMargin: 8
                anchors.rightMargin: 12
                spacing: 8
                ScrollView {
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    ScrollBar.vertical.policy: ScrollBar.AlwaysOff
                    Row {
                        height: 46
                        spacing: 6
                        Repeater {
                            model: BrowserBackend.tabs
                            delegate: Rectangle {
                                id: itemTab
                                property var view: modelData
                                width: 202
                                height: 38
                                radius: 8
                                color: view.active ? "#31465f" : "#24364d"
                                RowLayout {
                                    anchors.fill: parent
                                    anchors.leftMargin: 10
                                    anchors.rightMargin: 3
                                    Label {
                                        text: itemTab.view.title.length > 0 ?
                                                  itemTab.view.title : "New tab"
                                        color: "#f1f5f9"
                                        textFormat: Text.PlainText
                                        elide: Text.ElideRight
                                        Layout.fillWidth: true
                                    }
                                    ToolButton {
                                        text: "×"
                                        Accessible.name: "Close tab"
                                        onClicked: BrowserBackend.closeTab(itemTab.view.id,
                                                                            itemTab.view.generation)
                                    }
                                }
                                MouseArea {
                                    anchors.left: parent.left
                                    anchors.top: parent.top
                                    anchors.bottom: parent.bottom
                                    width: parent.width - 33
                                    onClicked: BrowserBackend.selectTab(itemTab.view.id,
                                                                         itemTab.view.generation)
                                }
                            }
                        }
                    }
                }
                ToolButton {
                    text: "+"
                    enabled: BrowserBackend.connected
                    Accessible.name: "New tab"
                    onClicked: BrowserBackend.newTab()
                }
            }
        }
        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: 57
            color: "#182539"
            RowLayout {
                anchors.fill: parent
                anchors.leftMargin: 12
                anchors.rightMargin: 12
                spacing: 9
                ToolButton {
                    text: "‹"
                    enabled: BrowserBackend.connected && BrowserBackend.canGoBack
                    Accessible.name: "Go back"
                    onClicked: BrowserBackend.goBack()
                }
                ToolButton {
                    text: "›"
                    enabled: BrowserBackend.connected && BrowserBackend.canGoForward
                    Accessible.name: "Go forward"
                    onClicked: BrowserBackend.goForward()
                }
                ToolButton {
                    text: "↻"
                    enabled: BrowserBackend.connected && BrowserBackend.activeTabId.length > 0
                    Accessible.name: "Reload"
                    onClicked: BrowserBackend.reload()
                }
                TextField {
                    id: address
                    Layout.fillWidth: true
                    placeholderText: "Enter a URL — handled by Oreslang"
                    text: BrowserBackend.activeUrl
                    enabled: BrowserBackend.connected && BrowserBackend.activeTabId.length > 0
                    selectByMouse: true
                    onAccepted: BrowserBackend.navigate(text)
                    Accessible.name: "Address bar"
                }
                ToolButton {
                    text: "Go"
                    enabled: address.enabled
                    onClicked: BrowserBackend.navigate(address.text)
                }
                ToolButton {
                    text: "🔔"
                    enabled: false
                    Accessible.name: "Notification center not yet integrated"
                }
                ToolButton {
                    text: "⋯"
                    enabled: false
                    Accessible.name: "Security and service worker controls not yet integrated"
                }
            }
        }
        Rectangle {
            Layout.fillWidth: true
            Layout.fillHeight: true
            color: "#111827"
            ColumnLayout {
                anchors.centerIn: parent
                width: Math.min(parent.width - 48, 620)
                spacing: 14
                Label {
                    Layout.alignment: Qt.AlignHCenter
                    text: "◈"
                    color: "#93c5fd"
                    font.pixelSize: 62
                }
                Label {
                    Layout.alignment: Qt.AlignHCenter
                    text: BrowserBackend.connected ?
                              "Renderer integration is not yet available" :
                              "Oreslang backend library not connected"
                    color: "#f8fafc"
                    font.pixelSize: 23
                    font.bold: true
                    wrapMode: Text.WordWrap
                    horizontalAlignment: Text.AlignHCenter
                }
                Label {
                    Layout.alignment: Qt.AlignHCenter
                    Layout.fillWidth: true
                    text: "Qt Quick is the privileged UI only. The Oreslang backend " +
                          "must manage tabs, navigation, permissions, notifications, " +
                          "service workers, and isolated renderer processes. " +
                          "No website is rendered by Qt and no WebView fallback is used."
                    color: "#a7b7cf"
                    font.pixelSize: 15
                    wrapMode: Text.WordWrap
                    horizontalAlignment: Text.AlignHCenter
                }
                Label {
                    Layout.alignment: Qt.AlignHCenter
                    Layout.fillWidth: true
                    text: BrowserBackend.statusMessage
                    textFormat: Text.PlainText
                    color: "#fca5a5"
                    wrapMode: Text.WordWrap
                    horizontalAlignment: Text.AlignHCenter
                }
            }
        }
        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: 30
            color: "#1c2a3d"
            Label {
                anchors.verticalCenter: parent.verticalCenter
                anchors.left: parent.left
                anchors.leftMargin: 12
                text: "Native Qt 6/QML shell   ·   Oreslang backend via C ABI v1   ·   No WebEngine"
                color: "#b7c6db"
                font.pixelSize: 11
            }
        }
    }
}
