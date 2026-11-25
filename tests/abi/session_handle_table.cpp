// Exact production-header contract test. This exercises ONLY the minimal
// native handle admission table, NOT the compiled Oreslang backend or Qt.
#include "ores_browser_session_handle_table_v1.h"
#include <atomic>
#include <cstdio>
#include <mutex>
#include <thread>
#include <vector>
#define CHECK(expr) do { if (!(expr)) { \
    std::fprintf(stderr, "HANDLE_TABLE_FAIL:%d:%s\n", __LINE__, #expr); \
    return 1; } } while (0)

int main() {
    auto& table = OresBrowserSessionHandleTableV1::instance();
    using Binding = OresBrowserGuestSessionBindingV1;
    using Handle = OresBrowserHandle;
    Binding out{};
    Handle* a = nullptr;
    Handle* b = nullptr;
    Handle* c = nullptr;
    CHECK(!table.admit({0, 1, 1}, &a) && !a);
    CHECK(!table.admit({1, 0, 1}, &a) && !a);
    CHECK(!table.admit({1, 1, 0}, &a) && !a);
    CHECK(!table.admit({1, 1, 1}, nullptr));
    CHECK(table.admit({1, 1, 1}, &a) && a);
    CHECK(table.admit({2, 1, 1}, &b) && b && b != a);
    CHECK(table.resolve(a, &out) && out.tenant_id == 1 &&
          out.actor_id == 1 && out.generation == 1);
    CHECK(table.resolve(b, &out) && out.tenant_id == 2);
    c = a; // even a populated output must be nulled on denial
    CHECK(!table.admit({1, 1, 1}, &c) && !c);
    unsigned char unrelated = 0;
    Handle* forged = reinterpret_cast<Handle*>(&unrelated);
    out = {9, 9, 9};
    CHECK(!table.resolve(forged, &out) && !out.actor_id);
    CHECK(!table.retire(forged, &out) && !out.actor_id);
    CHECK(!table.resolve(nullptr, &out) && !out.actor_id);
    CHECK(!table.retire(nullptr, &out) && !out.actor_id);
    CHECK(!table.resolve(a, nullptr));
    CHECK(!table.retire(a, nullptr));
    CHECK(table.retire(a, &out) && out.tenant_id == 1);
    CHECK(!table.resolve(a, &out) && !out.actor_id);
    CHECK(!table.retire(a, &out) && !out.actor_id);
    CHECK(table.resolve(b, &out) && out.tenant_id == 2);
    c = a;
    CHECK(!table.admit({1, 1, 1}, &c) && !c);
    c = a;
    CHECK(!table.admit({1, 1, 0}, &c) && !c);
    CHECK(table.admit({1, 1, 2}, &c) && c && c != a && c != b);
    Handle* future = a;
    CHECK(!table.admit({1, 1, 3}, &future) && !future);
    CHECK(!table.resolve(a, &out));
    CHECK(table.resolve(c, &out) && out.generation == 2);

    // Concurrent duplicate guest admission must have exactly one winner.
    std::atomic<int> winners{0}, failures{0};
    std::vector<Handle*> winnerHandles;
    std::mutex winnerLock;
    std::vector<std::thread> threads;
    for (int i = 0; i < 16; ++i) {
        threads.emplace_back([&] {
            Handle* h = nullptr;
            if (table.admit({1, 400, 1}, &h)) {
                ++winners;
                if (!h) ++failures;
                std::lock_guard<std::mutex> g(winnerLock);
                winnerHandles.push_back(h);
            } else if (h) {
                ++failures;
            }
        });
    }
    for (auto& thread : threads) thread.join();
    CHECK(winners == 1 && failures == 0 && winnerHandles.size() == 1);
    CHECK(table.resolve(winnerHandles[0], &out) && out.actor_id == 400);

    // Concurrent independently identified sessions must remain separable.
    threads.clear();
    std::vector<Handle*> concurrent;
    for (int t = 0; t < 8; ++t) {
        threads.emplace_back([&, t] {
            for (int j = 0; j < 16; ++j) {
                Handle* h = nullptr;
                Binding proposed{3, static_cast<std::uint64_t>(1000 + t*16 + j), 1};
                if (!table.admit(proposed, &h) || !h) { ++failures; continue; }
                Binding looked{};
                if (!table.resolve(h, &looked) ||
                    looked.actor_id != proposed.actor_id ||
                    looked.tenant_id != proposed.tenant_id) ++failures;
                std::lock_guard<std::mutex> g(winnerLock);
                concurrent.push_back(h);
            }
        });
    }
    for (auto& thread : threads) thread.join();
    CHECK(failures == 0 && concurrent.size() == 128);
    for (Handle* h : concurrent) {
        CHECK(table.retire(h, &out) && out.tenant_id == 3);
        CHECK(!table.resolve(h, &out));
    }
    CHECK(table.resolve(b, &out) && out.tenant_id == 2);
    CHECK(table.resolve(c, &out) && out.generation == 2);
    CHECK(table.retire(winnerHandles[0], &out));

    // 2 initial + 1 reopen + 1 race winner + 128 independent = 132.
    // Exhaust the FIXED LIFETIME budget, never recycle any retired token.
    std::vector<Handle*> remaining;
    for (std::uint64_t n = 0; n < table.kLifetimeSlots - 132; ++n) {
        Handle* h = nullptr;
        CHECK(table.admit({5, 9000 + n, 1}, &h) && h);
        CHECK(h != a && h != b && h != c);
        remaining.push_back(h);
    }
    Handle* denied = b;
    CHECK(!table.admit({5, 99999, 1}, &denied) && !denied);
    CHECK(table.resolve(b, &out) && out.tenant_id == 2);
    CHECK(!table.resolve(a, &out));
    CHECK(table.retire(b, &out));
    CHECK(table.retire(c, &out));
    for (Handle* h : remaining) CHECK(table.retire(h, &out));
    denied = c;
    CHECK(!table.admit({6, 100000, 1}, &denied) && !denied);
    CHECK(!table.resolve(b, &out) && !table.resolve(c, &out));

    std::puts("BROWSER_HANDLE_TABLE_256_LIFETIME_SLOTS_PASS (host runtime only; NOT guest/Qt)");
    return 0;
}
