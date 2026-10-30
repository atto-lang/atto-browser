#ifndef ORES_BROWSER_WIRE_VALIDATE_V1_H
#define ORES_BROWSER_WIRE_VALIDATE_V1_H
/* Portable, allocation-free validation of untrusted FFI VALUE RECORDS.
 * This is NOT a browser backend, URL parser, security sandbox, or UTF-8
 * validator. Oreslang remains the sole authority for tab state and policy.
 * Include only after ores_browser_ui_abi_v1.h (or include standalone).
 */
#include "ores_browser_ui_abi_v1.h"
#include <stddef.h>
#include <stdint.h>

static inline int ores_browser_zero_bytes_v1(const void *data, size_t n) {
  const unsigned char *bytes = (const unsigned char *)data;
  size_t i;
  if (!bytes) return 0;
  for (i = 0; i < n; ++i) {
    if (bytes[i] != 0u) return 0;
  }
  return 1;
}

/* Require a terminator, and canonical zero padding after first NUL.
 * UTF-8 correctness and bidirectional control protection are checked
 * separately by the Qt presentation boundary and trusted Oreslang host.
 */
static inline int ores_browser_wire_string_v1(const char *data, size_t cap) {
  size_t i, end = cap;
  if (!data || cap == 0u) return 0;
  for (i = 0; i < cap; ++i) {
    if (data[i] == '\0') { end = i; break; }
  }
  if (end == cap) return 0;
  return ores_browser_zero_bytes_v1(data + end, cap - end);
}

/* Strict host configuration admission before any actor/session allocation.
 * This checks the wire record only; profile authorization is a separate
 * privileged policy decision in the native Oreslang backend.
 */
static inline int ores_browser_validate_config_v1(
    const OresBrowserConfig *config) {
  return config != NULL &&
      config->struct_size == sizeof(*config) &&
      config->abi_version == ORES_BROWSER_UI_ABI_VERSION &&
      config->private_session <= 1u &&
      config->reserved == 0u;
}

static inline int ores_browser_validate_command_v1(
    const OresBrowserCommand *command) {
  if (!command || command->struct_size != sizeof(*command) ||
      command->operation < ORES_BROWSER_CMD_NEW_TAB ||
      command->operation > ORES_BROWSER_CMD_PREVIOUS_TAB) return 0;

  /* Session-scoped operations never borrow a tab capability. The other
   * operations always require an explicit tab ID and generation; the
   * trusted actor still verifies that capability belongs to this session.
   */
  if (command->operation == ORES_BROWSER_CMD_NEW_TAB ||
      command->operation == ORES_BROWSER_CMD_NEXT_TAB ||
      command->operation == ORES_BROWSER_CMD_PREVIOUS_TAB) {
    if (command->tab_id != 0u || command->tab_generation != 0u) return 0;
  } else if (command->tab_id == 0u || command->tab_generation == 0u) {
    return 0;
  }

  if (command->operation == ORES_BROWSER_CMD_NAVIGATE) {
    /* Reject empty navigation rather than trusting a backend to guess. */
    if (command->url[0] == '\0') return 0;
    return ores_browser_wire_string_v1(command->url, ORES_BROWSER_URL_BYTES);
  }
  if (command->operation == ORES_BROWSER_CMD_NEW_TAB) {
    /* A new tab may have no initial URL or a canonical, bounded URL field.
     * The browser actor is still responsible for canonicalizing and
     * authorizing the actual origin before any navigation occurs.
     */
    return ores_browser_wire_string_v1(command->url, ORES_BROWSER_URL_BYTES);
  }
  /* Every other command must not smuggle URL bytes. */
  return ores_browser_zero_bytes_v1(command->url, ORES_BROWSER_URL_BYTES);
}

static inline int ores_browser_validate_snapshot_v1(
    const OresBrowserSnapshot *snapshot,
    uint64_t previous_revision, int have_previous) {
  uint32_t i, j, active = 0;
  if (!snapshot ||
      snapshot->struct_size != sizeof(*snapshot) ||
      snapshot->abi_version != ORES_BROWSER_UI_ABI_VERSION ||
      snapshot->revision == 0u ||
      snapshot->tab_count > ORES_BROWSER_MAX_TABS ||
      snapshot->reserved != 0u ||
      (have_previous && snapshot->revision < previous_revision)) return 0;

  for (i = 0u; i < snapshot->tab_count; ++i) {
    const OresBrowserTabView *tab = &snapshot->tabs[i];
    if (tab->tab_id == 0u || tab->generation == 0u ||
        tab->active > 1u || tab->can_go_back > 1u ||
        tab->can_go_forward > 1u || tab->loading > 1u ||
        !ores_browser_wire_string_v1(tab->title, ORES_BROWSER_TITLE_BYTES) ||
        !ores_browser_wire_string_v1(tab->display_url, ORES_BROWSER_URL_BYTES))
      return 0;
    active += tab->active;
    for (j = 0u; j < i; ++j) {
      if (tab->tab_id == snapshot->tabs[j].tab_id) return 0;
    }
  }
  if ((snapshot->tab_count > 0u && active != 1u) ||
      (snapshot->tab_count == 0u && active != 0u)) return 0;

  /* One canonical wire representation for empty slots: no stale data. */
  for (i = snapshot->tab_count; i < ORES_BROWSER_MAX_TABS; ++i) {
    if (!ores_browser_zero_bytes_v1(&snapshot->tabs[i],
                                    sizeof(OresBrowserTabView))) return 0;
  }
  return 1;
}
#endif
