#ifndef ORES_BROWSER_UI_QUEUE_V1_H
#define ORES_BROWSER_UI_QUEUE_V1_H
#include <cstdint>

// UI-event-thread-only admission for queued commands targeting the FFI worker.
// The backend may wedge; bounding queued invocations prevents unbounded growth.
// No backend state, actor ownership, or cross-thread synchronization lives here.
class OresBrowserUiQueueV1 final {
public:
    static constexpr std::uint32_t kMaxPending = 64u;
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
#endif
