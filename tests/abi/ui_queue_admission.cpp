#include "ores_browser_ui_queue_v1.h"
#include <cassert>
#include <cstdint>
#include <initializer_list>
#include <cstddef>

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

    // Lengths are checked *before* capturing QString arguments into Qt's
    // queued lambda. A hostile text field cannot enqueue arbitrary megabytes.
    using Q = OresBrowserUiQueueV1;
    assert(Q::captureFits(ORES_BROWSER_CMD_NEW_TAB, 0, 0, 0));
    assert(!Q::captureFits(ORES_BROWSER_CMD_NEW_TAB, 1, 0, 0));
    assert(!Q::captureFits(ORES_BROWSER_CMD_NEW_TAB, 0, 0, 1));
    assert(Q::captureFits(ORES_BROWSER_CMD_SELECT_TAB, 20, 20, 0));
    assert(!Q::captureFits(ORES_BROWSER_CMD_SELECT_TAB, 21, 20, 0));
    assert(!Q::captureFits(ORES_BROWSER_CMD_SELECT_TAB, 20, 21, 0));
    assert(!Q::captureFits(ORES_BROWSER_CMD_SELECT_TAB, 0, 1, 0));
    assert(!Q::captureFits(ORES_BROWSER_CMD_SELECT_TAB, 1, 0, 0));
    assert(!Q::captureFits(ORES_BROWSER_CMD_SELECT_TAB, 1, 1, 1));
    assert(Q::captureFits(ORES_BROWSER_CMD_NAVIGATE, 20, 20,
                           ORES_BROWSER_URL_BYTES - 1u));
    assert(!Q::captureFits(ORES_BROWSER_CMD_NAVIGATE, 1, 1, 0));
    assert(!Q::captureFits(ORES_BROWSER_CMD_NAVIGATE, 1, 1,
                            ORES_BROWSER_URL_BYTES));
    assert(!Q::captureFits(ORES_BROWSER_CMD_PREVIOUS_TAB + 1u,
                            1, 1, 0));
    assert(!Q::captureFits(0u, 0, 0, 0));
    for (std::size_t n : {std::size_t(0), std::size_t(1),
                          std::size_t(ORES_BROWSER_URL_BYTES - 1u),
                          std::size_t(ORES_BROWSER_URL_BYTES),
                          std::size_t(ORES_BROWSER_URL_BYTES) * 1024u}) {
        bool accepted = Q::captureFits(ORES_BROWSER_CMD_NAVIGATE, 1, 1, n);
        assert(accepted == (n > 0u && n < ORES_BROWSER_URL_BYTES));
    }
}
