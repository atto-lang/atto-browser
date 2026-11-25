#include "ores_browser_wire_validate_v1.h"
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>

#define EXPECT(c, name) do { \
  if (!(c)) { fprintf(stderr, "FAIL:%s\n", name); free(snapshot); return 1; } \
} while (0)

int main(void) {
  OresBrowserConfig config = {0};
  config.struct_size = sizeof(config);
  config.abi_version = ORES_BROWSER_UI_ABI_VERSION;
  /* Check startup admission without allowing a malformed record to
     influence tenant/session selection in a future Oreslang backend. */
  if (!ores_browser_validate_config_v1(&config)) return 3;
  config.private_session = 1u;
  if (!ores_browser_validate_config_v1(&config)) return 4;
  config.private_session = 2u;
  if (ores_browser_validate_config_v1(&config)) return 5;
  config.private_session = 0u;
  config.reserved = 1u;
  if (ores_browser_validate_config_v1(&config)) return 6;
  config.reserved = 0u;
  config.abi_version++;
  if (ores_browser_validate_config_v1(&config)) return 7;
  config.abi_version = ORES_BROWSER_UI_ABI_VERSION;
  config.struct_size--;
  if (ores_browser_validate_config_v1(&config)) return 8;
  if (ores_browser_validate_config_v1(NULL)) return 9;

  OresBrowserSnapshot *snapshot =
      (OresBrowserSnapshot *)calloc(1u, sizeof(OresBrowserSnapshot));
  OresBrowserCommand command = {0};
  if (!snapshot) return 2;
  snapshot->struct_size = sizeof(*snapshot);
  snapshot->abi_version = ORES_BROWSER_UI_ABI_VERSION;
  snapshot->revision = 7u;
  snapshot->tab_count = 2u;
  snapshot->tabs[0].tab_id = 41u;
  snapshot->tabs[0].generation = 5u;
  snapshot->tabs[0].active = 1u;
  snapshot->tabs[0].title[0] = 'A';
  snapshot->tabs[1].tab_id = 42u;
  snapshot->tabs[1].generation = 1u;
  EXPECT(ores_browser_validate_snapshot_v1(snapshot, 6u, 1), "valid");
  EXPECT(ores_browser_validate_snapshot_v1(snapshot, 7u, 1), "same-revision-layout");
  EXPECT(!ores_browser_validate_snapshot_v1(snapshot, 8u, 1), "stale-revision");
  snapshot->revision = 0u;
  EXPECT(!ores_browser_validate_snapshot_v1(snapshot, 0u, 0), "zero-revision");
  snapshot->revision = 7u;

  snapshot->tabs[1].tab_id = 41u;
  EXPECT(!ores_browser_validate_snapshot_v1(snapshot, 0u, 0), "duplicate-id");
  snapshot->tabs[1].tab_id = 42u;
  snapshot->tabs[1].active = 1u;
  EXPECT(!ores_browser_validate_snapshot_v1(snapshot, 0u, 0), "two-active");
  snapshot->tabs[1].active = 0u;
  snapshot->tabs[0].active = 0u;
  EXPECT(!ores_browser_validate_snapshot_v1(snapshot, 0u, 0), "no-active");
  snapshot->tabs[0].active = 1u;

  snapshot->tabs[0].loading = 2u;
  EXPECT(!ores_browser_validate_snapshot_v1(snapshot, 0u, 0), "nonbool");
  snapshot->tabs[0].loading = 0u;
  snapshot->tabs[0].title[5] = 'X';
  EXPECT(!ores_browser_validate_snapshot_v1(snapshot, 0u, 0), "title-tail");
  snapshot->tabs[0].title[5] = 0;
  memset(snapshot->tabs[1].display_url, 'X', ORES_BROWSER_URL_BYTES);
  EXPECT(!ores_browser_validate_snapshot_v1(snapshot, 0u, 0), "unterminated-url");
  memset(snapshot->tabs[1].display_url, 0, ORES_BROWSER_URL_BYTES);
  snapshot->tabs[2].tab_id = 99u;
  EXPECT(!ores_browser_validate_snapshot_v1(snapshot, 0u, 0), "unused-slot");
  snapshot->tabs[2].tab_id = 0u;
  snapshot->reserved = 1u;
  EXPECT(!ores_browser_validate_snapshot_v1(snapshot, 0u, 0), "reserved");
  snapshot->reserved = 0u;
  snapshot->tab_count = ORES_BROWSER_MAX_TABS + 1u;
  EXPECT(!ores_browser_validate_snapshot_v1(snapshot, 0u, 0), "too-many-tabs");
  snapshot->tab_count = 2u;
  snapshot->abi_version = 2u;
  EXPECT(!ores_browser_validate_snapshot_v1(snapshot, 0u, 0), "bad-version");
  snapshot->abi_version = 1u;

  command.struct_size = sizeof(command);
  command.operation = ORES_BROWSER_CMD_NEW_TAB;
  EXPECT(ores_browser_validate_command_v1(&command), "new-tab");
  memcpy(command.url, "https://a.test/", 16u);
  EXPECT(ores_browser_validate_command_v1(&command), "new-tab-optional-url");
  command.url[200] = 'X';
  EXPECT(!ores_browser_validate_command_v1(&command), "new-tab-url-nonzero-padding");
  command.url[200] = 0;
  memset(command.url, 'X', sizeof(command.url));
  EXPECT(!ores_browser_validate_command_v1(&command), "new-tab-url-unterminated");
  memset(command.url, 0, sizeof(command.url));
  EXPECT(ores_browser_validate_command_v1(&command), "restored-empty-new-tab-url");
  command.url[0] = (char)0x80;
  EXPECT(!ores_browser_validate_command_v1(&command), "new-tab-url-invalid-utf8");
  command.url[0] = 0;
  command.tab_id = 1u;
  EXPECT(!ores_browser_validate_command_v1(&command), "new-tab-smuggle");
  command.tab_id = 0u;
  command.operation = ORES_BROWSER_CMD_NAVIGATE;
  command.tab_id = 41u; command.tab_generation = 5u;
  EXPECT(!ores_browser_validate_command_v1(&command), "empty-nav");
  memcpy(command.url, "https://a.test/", 16u);
  EXPECT(ores_browser_validate_command_v1(&command), "valid-nav");
  command.url[100] = 'X';
  EXPECT(!ores_browser_validate_command_v1(&command), "nav-padding");
  command.url[100] = 0;
  command.operation = ORES_BROWSER_CMD_CLOSE_TAB;
  EXPECT(!ores_browser_validate_command_v1(&command), "unexpected-url");
  memset(command.url, 0, sizeof(command.url));
  EXPECT(ores_browser_validate_command_v1(&command), "valid-close");
  command.operation = ORES_BROWSER_CMD_NEXT_TAB;
  command.tab_id = 0u; command.tab_generation = 0u;
  EXPECT(ores_browser_validate_command_v1(&command), "session-scoped-next");
  command.tab_id = 41u; command.tab_generation = 5u;
  EXPECT(!ores_browser_validate_command_v1(&command), "next-tab-smuggle");
  command.operation = ORES_BROWSER_CMD_PREVIOUS_TAB;
  command.tab_id = 0u; command.tab_generation = 0u;
  EXPECT(ores_browser_validate_command_v1(&command), "session-scoped-previous");
  command.tab_generation = 1u;
  EXPECT(!ores_browser_validate_command_v1(&command), "previous-generation-smuggle");
  command.tab_generation = 0u;
  command.operation = ORES_BROWSER_CMD_SELECT_TAB;
  EXPECT(!ores_browser_validate_command_v1(&command), "missing-tab-capability");
  command.operation = 999u;
  EXPECT(!ores_browser_validate_command_v1(&command), "unknown-op");

  EXPECT(ores_browser_validate_snapshot_v1(snapshot, 0u, 0), "restored");
  free(snapshot);
  puts("ABI_WIRE_ADVERSARIAL_PASS");
  return 0;
}
