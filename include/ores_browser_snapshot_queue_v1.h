#ifndef ORES_BROWSER_SNAPSHOT_QUEUE_V1_H
#define ORES_BROWSER_SNAPSHOT_QUEUE_V1_H
#include <cstdint>

// Worker-thread-only admission for immutable snapshots sent to the Qt UI.
// Only one snapshot may be in flight; the UI acknowledges it by revision.
// A stopped UI event loop cannot accumulate unbounded queued QVariantLists.
class OresBrowserSnapshotQueueV1 final {
public:
    bool pending() const noexcept { return outstanding_revision_ != 0u; }
    std::uint64_t outstandingRevision() const noexcept {
        return outstanding_revision_;
    }
    bool tryReserve(std::uint64_t revision) noexcept {
        if (revision == 0u || pending()) return false;
        outstanding_revision_ = revision;
        return true;
    }
    bool acknowledge(std::uint64_t revision) noexcept {
        if (revision == 0u || outstanding_revision_ != revision) return false;
        outstanding_revision_ = 0u;
        return true;
    }
    void reset() noexcept { outstanding_revision_ = 0u; }
private:
    std::uint64_t outstanding_revision_ = 0u;
};
#endif
