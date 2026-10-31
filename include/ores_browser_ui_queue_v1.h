#ifndef ORES_BROWSER_UI_QUEUE_V1_H
#define ORES_BROWSER_UI_QUEUE_V1_H
#include <cstdint>
#include <cstddef>
#include "ores_browser_ui_abi_v1.h"

// UI-event-thread-only admission for queued commands targeting the FFI worker.
// The backend may wedge; bounding queued invocations prevents unbounded growth.
// No backend state, actor ownership, or cross-thread synchronization lives here.
class OresBrowserUiQueueV1 final {
public:
    static constexpr std::uint32_t kMaxPending = 64u;
    // Qt QString::size() measures UTF-16 code units; bytes encoded later in
    // BackendWorker::submit may be larger, and that boundary still validates
    // the final UTF-8 against ORES_BROWSER_URL_BYTES. This pre-admission
    // bound protects queued captures before allocating QString copies.
    static bool captureFits(std::uint32_t op, std::size_t id,
                            std::size_t generation, std::size_t url) noexcept {
        if (op < ORES_BROWSER_CMD_NEW_TAB ||
            op > ORES_BROWSER_CMD_PREVIOUS_TAB ||
            id > 20u || generation > 20u || 
            url >= ORES_BROWSER_URL_BYTES) return false;
        if (op == ORES_BROWSER_CMD_NEW_TAB) {
            return id == 0u && generation == 0u && url == 0u;
        }
        if (id == 0u || generation == 0u) return false;
        return op == ORES_BROWSER_CMD_NAVIGATE ? url != 0u : url == 0u;
    }
    bool tryReserve() noexcept {
        if (pending_ >= kMaxPending) return false;
        ++pending_;
        return true;
    }
    bool complete() noexcept {
        if (pending_ == 0u) return false;
        --pending_;
        return true;
    }
    std::uint32_t pending() const noexcept { return pending_; }
private:
    std::uint32_t pending_ = 0u;
};
// Worker-thread-only, one outstanding UI snapshot signal. The worker cannot
// enqueue unbounded QVariant snapshots if the GUI event loop is delayed.
// Qt's queued delivery of the GUI acknowledgement releases the reservation.
class OresBrowserViewGateV1 final {
public:
    bool tryReserve() noexcept {
        if (outstanding_) return false;
        outstanding_ = true;
        return true;
    }
    bool acknowledge() noexcept {
        if (!outstanding_) return false;
        outstanding_ = false;
        return true;
    }
    bool pending() const noexcept { return outstanding_; }
private:
    bool outstanding_ = false;
};

#endif
