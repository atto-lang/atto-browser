#include "ores_browser_ui_queue_v1.h"
#include <cassert>
#include <cstdint>

int main() {
    OresBrowserUiQueueV1 q;
    assert(q.pending() == 0u);
    assert(!q.complete()); // spurious completion must not underflow
    for (std::uint32_t i = 0; i < q.kMaxPending; ++i) {
        assert(q.tryReserve());
        assert(q.pending() == i + 1u);
    }
    for (unsigned i = 0; i < 100000u; ++i) {
        assert(!q.tryReserve()); // hung worker cannot grow the queue
        assert(q.pending() == q.kMaxPending);
    }
    assert(q.complete());
    assert(q.pending() == q.kMaxPending - 1u);
    assert(q.tryReserve());
    for (std::uint32_t i = 0; i < q.kMaxPending; ++i) {
        assert(q.complete());
    }
    assert(q.pending() == 0u);
    assert(!q.complete());
    for (unsigned round = 0; round < 1024u; ++round) {
        for (unsigned i = 0; i < q.kMaxPending; ++i) assert(q.tryReserve());
        assert(!q.tryReserve());
        for (unsigned i = 0; i < q.kMaxPending; ++i) assert(q.complete());
    }
    assert(q.pending() == 0u);
}
