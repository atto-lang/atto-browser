#include "ores_browser_snapshot_queue_v1.h"
#include <cstdint>
#include <cstdio>

#define CHECK(expr) do { \
    if (!(expr)) { std::fprintf(stderr, "FAIL:%s:%d:%s\\n", __FILE__, __LINE__, #expr); return 1; } \
} while (0)

int main() {
    OresBrowserSnapshotQueueV1 gate;
    CHECK(!gate.pending());
    CHECK(!gate.tryReserve(0u));
    CHECK(!gate.acknowledge(0u));
    CHECK(gate.tryReserve(7u));
    CHECK(gate.pending() && gate.outstandingRevision() == 7u);
    for (unsigned i = 0; i < 100000u; ++i) {
        CHECK(!gate.tryReserve(8u));
        CHECK(!gate.acknowledge(8u));
        CHECK(gate.outstandingRevision() == 7u);
    }
    CHECK(gate.acknowledge(7u));
    CHECK(!gate.pending());
    CHECK(!gate.acknowledge(7u));
    CHECK(gate.tryReserve(8u));
    CHECK(gate.acknowledge(8u));
    for (std::uint64_t rev = 9u; rev < 1033u; ++rev) {
        CHECK(gate.tryReserve(rev));
        CHECK(!gate.tryReserve(rev));
        CHECK(!gate.acknowledge(rev + 1u));
        CHECK(gate.acknowledge(rev));
    }
    CHECK(gate.tryReserve(UINT64_MAX));
    CHECK(gate.pending());
    gate.reset(); // shutdown cancels an unconsumed UI delivery
    CHECK(!gate.pending());
    CHECK(!gate.acknowledge(UINT64_MAX));
    CHECK(gate.tryReserve(1u));
    CHECK(gate.acknowledge(1u));
    std::puts("ABI_SNAPSHOT_BACKPRESSURE_PASS");
    return 0;
}
