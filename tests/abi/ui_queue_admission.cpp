#include "ores_browser_ui_queue_v1.h"
#include <cstdio>
#include <cstdlib>
#define CHECK(expr) do { \
    if (!(expr)) { \
        std::fprintf(stderr, "UI queue assertion failed %s:%d: %s\n", __FILE__, __LINE__, #expr); \
        std::exit(1); \
    } \
} while (0)
#include <cstdint>
#include <initializer_list>
#include <cstddef>

int main() {
    OresBrowserUiQueueV1 q;
    CHECK(q.pending() == 0u);
    CHECK(!q.complete()); // spurious completion must not underflow
    for (std::uint32_t i = 0; i < q.kMaxPending; ++i) {
        CHECK(q.tryReserve());
        CHECK(q.pending() == i + 1u);
    }
    for (unsigned i = 0; i < 100000u; ++i) {
        CHECK(!q.tryReserve()); // hung worker cannot grow the queue
        CHECK(q.pending() == q.kMaxPending);
    }
    CHECK(q.complete());
    CHECK(q.pending() == q.kMaxPending - 1u);
    CHECK(q.tryReserve());
    for (std::uint32_t i = 0; i < q.kMaxPending; ++i) {
        CHECK(q.complete());
    }
    CHECK(q.pending() == 0u);
    CHECK(!q.complete());
    for (unsigned round = 0; round < 1024u; ++round) {
        for (unsigned i = 0; i < q.kMaxPending; ++i) CHECK(q.tryReserve());
        CHECK(!q.tryReserve());
        for (unsigned i = 0; i < q.kMaxPending; ++i) CHECK(q.complete());
    }
    CHECK(q.pending() == 0u);

    // A blocked/slow GUI can only have one outstanding revision across
    // arbitrary worker poll/command iterations. Acknowledgement advances
    // admission and a spurious/double acknowledgement does not underflow.
    OresBrowserViewGateV1 view;
    CHECK(!view.pending());
    CHECK(!view.acknowledge());
    CHECK(view.tryReserve());
    CHECK(view.pending());
    for (unsigned i = 0; i < 100000u; ++i) {
        CHECK(!view.tryReserve());
        CHECK(view.pending());
    }
    CHECK(view.acknowledge());
    CHECK(!view.pending());
    CHECK(!view.acknowledge());
    for (unsigned i = 0; i < 1024u; ++i) {
        CHECK(view.tryReserve());
        CHECK(!view.tryReserve());
        CHECK(view.acknowledge());
        CHECK(!view.pending());
    }

    // Lengths are checked *before* capturing QString arguments into Qt's
    // queued lambda. A hostile text field cannot enqueue arbitrary megabytes.
    using Q = OresBrowserUiQueueV1;
    CHECK(Q::captureFits(ORES_BROWSER_CMD_NEW_TAB, 0, 0, 0));
    CHECK(!Q::captureFits(ORES_BROWSER_CMD_NEW_TAB, 1, 0, 0));
    CHECK(!Q::captureFits(ORES_BROWSER_CMD_NEW_TAB, 0, 0, 1));
    CHECK(Q::captureFits(ORES_BROWSER_CMD_NEXT_TAB, 0, 0, 0));
    CHECK(Q::captureFits(ORES_BROWSER_CMD_PREVIOUS_TAB, 0, 0, 0));
    CHECK(!Q::captureFits(ORES_BROWSER_CMD_NEXT_TAB, 1, 0, 0));
    CHECK(!Q::captureFits(ORES_BROWSER_CMD_NEXT_TAB, 0, 1, 0));
    CHECK(!Q::captureFits(ORES_BROWSER_CMD_PREVIOUS_TAB, 0, 0, 1));
    CHECK(!Q::captureFits(ORES_BROWSER_CMD_PREVIOUS_TAB, 1, 1, 0));
    CHECK(Q::captureFits(ORES_BROWSER_CMD_SELECT_TAB, 20, 20, 0));
    CHECK(!Q::captureFits(ORES_BROWSER_CMD_SELECT_TAB, 21, 20, 0));
    CHECK(!Q::captureFits(ORES_BROWSER_CMD_SELECT_TAB, 20, 21, 0));
    CHECK(!Q::captureFits(ORES_BROWSER_CMD_SELECT_TAB, 0, 1, 0));
    CHECK(!Q::captureFits(ORES_BROWSER_CMD_SELECT_TAB, 1, 0, 0));
    CHECK(!Q::captureFits(ORES_BROWSER_CMD_SELECT_TAB, 1, 1, 1));
    CHECK(Q::captureFits(ORES_BROWSER_CMD_NAVIGATE, 20, 20,
                           ORES_BROWSER_URL_BYTES - 1u));
    CHECK(!Q::captureFits(ORES_BROWSER_CMD_NAVIGATE, 1, 1, 0));
    CHECK(!Q::captureFits(ORES_BROWSER_CMD_NAVIGATE, 1, 1,
                            ORES_BROWSER_URL_BYTES));
    CHECK(!Q::captureFits(ORES_BROWSER_CMD_PREVIOUS_TAB + 1u,
                            1, 1, 0));
    CHECK(!Q::captureFits(0u, 0, 0, 0));
    for (std::size_t n : {std::size_t(0), std::size_t(1),
                          std::size_t(ORES_BROWSER_URL_BYTES - 1u),
                          std::size_t(ORES_BROWSER_URL_BYTES),
                          std::size_t(ORES_BROWSER_URL_BYTES) * 1024u}) {
        bool accepted = Q::captureFits(ORES_BROWSER_CMD_NAVIGATE, 1, 1, n);
        CHECK(accepted == (n > 0u && n < ORES_BROWSER_URL_BYTES));
    }
}
