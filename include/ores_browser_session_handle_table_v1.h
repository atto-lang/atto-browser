#ifndef ORES_BROWSER_SESSION_HANDLE_TABLE_V1_H
#define ORES_BROWSER_SESSION_HANDLE_TABLE_V1_H

// Runtime FFI HANDLE ADMISSION ONLY. Oreslang owns lifecycle and tab state.
// This table never creates a guest actor, dispatches a tab command, reads a
// snapshot, authenticates a tenant, or implements ores_browser_* exports.
//
// A handle is an address-unique, *never-reused* opaque marker. We compare
// its address to our owned markers BEFORE accessing registry metadata. We
// never dereference the caller-provided OresBrowserHandle*.
//
// Capacity is a deliberately bounded lifetime budget (not just concurrent
// capacity). Exhaustion is fail-closed, never reuse a retired address.
// The table MUST be process-lifetime. Never destroy and recreate it in a
// process that might retain stale pointers to its previous instance.
#include "ores_browser_ui_abi_v1.h"
#include <array>
#include <cstddef>
#include <cstdint>
#include <mutex>

struct OresBrowserGuestSessionBindingV1 {
    std::uint64_t tenant_id = 0;
    std::uint64_t actor_id = 0;
    std::uint64_t generation = 0;
};

class OresBrowserSessionHandleTableV1 final {
public:
    static constexpr std::size_t kLifetimeSlots = 256;

    // The only supported construction is this process-lifetime instance.
    static OresBrowserSessionHandleTableV1& instance() {
        static OresBrowserSessionHandleTableV1 table;
        return table;
    }

    OresBrowserSessionHandleTableV1(const OresBrowserSessionHandleTableV1&) = delete;
    OresBrowserSessionHandleTableV1& operator=(const OresBrowserSessionHandleTableV1&) = delete;

    // Called ONLY after a trusted Oreslang runtime acknowledges an ACTUAL
    // live session actor and supplies its verified binding. Not an OPEN.
    bool admit(const OresBrowserGuestSessionBindingV1& binding,
               OresBrowserHandle** output) {
        if (!output) return false;
        *output = nullptr;
        if (!valid(binding)) return false;
        std::lock_guard<std::mutex> guard(mu_);
        if (next_ >= entries_.size()) return false;
        for (std::size_t i = 0; i < next_; ++i) {
            const Entry& previous = entries_[i];
            if (previous.binding.tenant_id == binding.tenant_id &&
                previous.binding.actor_id == binding.actor_id) {
                // A guest actor has at most one live session generation.
                // Reopening after retirement requires a strictly newer one.
                if (previous.live ||
                    binding.generation <= previous.binding.generation)
                    return false;
            }
        }
        Entry& entry = entries_[next_++];
        entry.binding = binding;
        entry.live = true;
        *output = token(entry);
        return true;
    }

    // Resolves ONLY a currently admitted handle. A forged/random pointer
    // is never dereferenced. Actor-side admission must still enforce tenant,
    // generation, ownership and cancellation on every guest operation.
    bool resolve(const OresBrowserHandle* input,
                 OresBrowserGuestSessionBindingV1* output) {
        if (!output) return false;
        *output = {};
        if (!input) return false;
        std::lock_guard<std::mutex> guard(mu_);
        for (std::size_t i = 0; i < next_; ++i) {
            const Entry& entry = entries_[i];
            if (input == token(entry)) {
                if (!entry.live) return false;
                *output = entry.binding;
                return true;
            }
        }
        return false;
    }

    // Invalid/retired pointers cannot retire another session. The guest
    // actor's termination is a separate, required Oreslang runtime action.
    bool retire(const OresBrowserHandle* input,
                OresBrowserGuestSessionBindingV1* output) {
        if (!output) return false;
        *output = {};
        if (!input) return false;
        std::lock_guard<std::mutex> guard(mu_);
        for (std::size_t i = 0; i < next_; ++i) {
            Entry& entry = entries_[i];
            if (input == token(entry)) {
                if (!entry.live) return false;
                *output = entry.binding;
                entry.live = false;
                // Keep this spent actor identity as a non-reusable high-water
                // mark. Resolution still returns nothing for retired handles.
                return true;
            }
        }
        return false;
    }

private:
    struct Entry {
        // Stable, distinct allocation within a non-relocating std::array.
        // Marker storage is never exposed as a live Oreslang object.
        alignas(std::max_align_t) unsigned char marker[sizeof(void*)] = {};
        OresBrowserGuestSessionBindingV1 binding{};
        bool live = false;
    };
    OresBrowserSessionHandleTableV1() = default;
    ~OresBrowserSessionHandleTableV1() = default;

    static bool valid(const OresBrowserGuestSessionBindingV1& b) {
        return b.tenant_id != 0 && b.actor_id != 0 && b.generation != 0;
    }
    static const OresBrowserHandle* token(const Entry& entry) {
        // Object pointer conversion only; never dereference as handle.
        return reinterpret_cast<const OresBrowserHandle*>(&entry.marker);
    }
    static OresBrowserHandle* token(Entry& entry) {
        return reinterpret_cast<OresBrowserHandle*>(&entry.marker);
    }

    std::mutex mu_;
    std::array<Entry, kLifetimeSlots> entries_{};
    std::size_t next_ = 0;
};
#endif
