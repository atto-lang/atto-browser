/* Executable integration test for the ACTUAL native Oreslang backend.
 * This file supplies NO stub browser implementation and cannot succeed
 * without all five exported symbols and real backend-owned tab state.
 * Run only against a verified/pinned AOT Oreslang library built for this ABI.
 */
#include "ores_browser_ui_abi_v1.h"
#include "ores_browser_wire_validate_v1.h"
#include <dlfcn.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef uint32_t (*VersionFn)(void);
typedef int32_t (*OpenFn)(const OresBrowserConfig*, OresBrowserHandle**);
typedef int32_t (*DispatchFn)(OresBrowserHandle*, const OresBrowserCommand*);
typedef int32_t (*SnapshotFn)(OresBrowserHandle*, OresBrowserSnapshot*);
typedef void (*CloseFn)(OresBrowserHandle*);

static void die(const char *why) {
  fprintf(stderr, "BROWSER_BACKEND_FFI_FAIL: %s\n", why);
  exit(1);
}
static void symbol(void *library, const char *name, void *out, size_t size) {
  void *p = dlsym(library, name);
  if (!p || size != sizeof(p)) die("missing or nonportable function export");
  memcpy(out, &p, size); /* Avoid ISO C object/function pointer cast warning. */
}
static void command(OresBrowserCommand *cmd, uint32_t op,
                    uint64_t id, uint64_t gen) {
  memset(cmd, 0, sizeof(*cmd));
  cmd->struct_size = (uint32_t)sizeof(*cmd);
  cmd->operation = op;
  cmd->tab_id = id;
  cmd->tab_generation = gen;
  if (!ores_browser_validate_command_v1(cmd)) die("local command shape");
}
static void snapshot(SnapshotFn read, OresBrowserHandle *handle,
                     OresBrowserSnapshot *view, uint64_t prev) {
  memset(view, 0, sizeof(*view));
  view->struct_size = (uint32_t)sizeof(*view);
  view->abi_version = ORES_BROWSER_UI_ABI_VERSION;
  if (read(handle, view) != ORES_BROWSER_OK) die("snapshot status");
  if (!ores_browser_validate_snapshot_v1(view, prev, prev != 0u))
    die("invalid backend snapshot");
}
static const OresBrowserTabView *find_tab(const OresBrowserSnapshot *view,
                                         uint64_t id) {
  uint32_t i;
  for (i = 0u; i < view->tab_count; ++i) {
    if (view->tabs[i].tab_id == id) return &view->tabs[i];
  }
  return NULL;
}
int main(int argc, char **argv) {
  void *library;
  VersionFn version = NULL;
  OpenFn open_session = NULL;
  DispatchFn dispatch = NULL;
  SnapshotFn read = NULL;
  CloseFn close_session = NULL;
  OresBrowserConfig config = {0};
  OresBrowserHandle *browser = NULL;
  OresBrowserHandle *other = NULL;
  OresBrowserHandle *rejected_handle = NULL;
  OresBrowserConfig bad_config = {0};
  OresBrowserCommand cmd = {0};
  OresBrowserSnapshot *view;
  uint64_t revision, first_id, first_gen, second_id, second_gen;
  int32_t status;
  if (argc != 2 || argv[1][0] != '/') die("absolute backend library argument");
  library = dlopen(argv[1], RTLD_NOW | RTLD_LOCAL);
  if (!library) die("cannot load signed, pinned backend library");
  symbol(library, "ores_browser_abi_version", &version, sizeof(version));
  symbol(library, "ores_browser_open", &open_session, sizeof(open_session));
  symbol(library, "ores_browser_dispatch", &dispatch, sizeof(dispatch));
  symbol(library, "ores_browser_snapshot", &read, sizeof(read));
  symbol(library, "ores_browser_close", &close_session, sizeof(close_session));
  if (version() != ORES_BROWSER_UI_ABI_VERSION) die("backend ABI version");
  config.struct_size = (uint32_t)sizeof(config);
  config.abi_version = ORES_BROWSER_UI_ABI_VERSION;
  if (open_session(&config, &browser) != ORES_BROWSER_OK || !browser)
    die("backend open (requires trusted fresh test session)");
  // Start the output slot non-NULL. Invalid OPEN must actively clear a
  // previously populated output slot; leaving it unchanged is unsafe.
  rejected_handle = browser;
  bad_config = config;
  bad_config.reserved = 1u;
  if (open_session(&bad_config, &rejected_handle) != ORES_BROWSER_INVALID ||
      rejected_handle != NULL)
    die("backend accepted nonzero reserved config");
  rejected_handle = browser;
  bad_config = config;
  bad_config.struct_size = 0u;
  if (open_session(&bad_config, &rejected_handle) != ORES_BROWSER_INVALID ||
      rejected_handle != NULL)
    die("backend accepted invalid config size");
  rejected_handle = browser;
  bad_config = config;
  bad_config.abi_version = ORES_BROWSER_UI_ABI_VERSION + 1u;
  if (open_session(&bad_config, &rejected_handle) != ORES_BROWSER_INVALID ||
      rejected_handle != NULL)
    die("backend accepted unsupported ABI version");
  rejected_handle = browser;
  bad_config = config;
  bad_config.private_session = 2u;
  if (open_session(&bad_config, &rejected_handle) != ORES_BROWSER_INVALID ||
      rejected_handle != NULL)
    die("backend accepted invalid private-session flag");
  if (open_session(&config, &other) != ORES_BROWSER_OK || !other ||
      browser == other)
    die("backend concurrent sessions alias or second open refused");
  view = (OresBrowserSnapshot*)calloc(1u, sizeof(*view));
  if (!view) die("test allocation");
  snapshot(read, browser, view, 0u);
  if (view->tab_count != 0u) die("test session must start with zero tabs");
  revision = view->revision;
  snapshot(read, other, view, 0u);
  if (view->tab_count != 0u)
    die("second session must start independently empty");
  command(&cmd, ORES_BROWSER_CMD_NEW_TAB, 0u, 0u);
  if (dispatch(browser, &cmd) != ORES_BROWSER_OK) die("create first tab");
  snapshot(read, browser, view, revision);
  if (view->revision <= revision || view->tab_count != 1u ||
      view->tabs[0].active != 1u) die("first tab state");
  first_id = view->tabs[0].tab_id;
  first_gen = view->tabs[0].generation;
  revision = view->revision;
  command(&cmd, ORES_BROWSER_CMD_NEW_TAB, 0u, 0u);
  if (dispatch(browser, &cmd) != ORES_BROWSER_OK) die("create second tab");
  snapshot(read, browser, view, revision);
  if (view->revision <= revision || view->tab_count != 2u ||
      !find_tab(view, first_id)) die("second tab state");
  second_id = view->tabs[0].tab_id == first_id
                  ? view->tabs[1].tab_id : view->tabs[0].tab_id;
  if (second_id == first_id || second_id == 0u) die("duplicate tab identity");
  second_gen = find_tab(view, second_id)->generation;
  revision = view->revision;
  command(&cmd, ORES_BROWSER_CMD_SELECT_TAB, first_id, first_gen);
  if (dispatch(browser, &cmd) != ORES_BROWSER_OK) die("select first");
  snapshot(read, browser, view, revision);
  if (view->revision <= revision || !find_tab(view, first_id) ||
      find_tab(view, first_id)->active != 1u) die("selected first");
  revision = view->revision;
  command(&cmd, ORES_BROWSER_CMD_CLOSE_TAB, first_id, first_gen);
  if (dispatch(browser, &cmd) != ORES_BROWSER_OK) die("close first");
  snapshot(read, browser, view, revision);
  if (view->revision <= revision || view->tab_count != 1u ||
      find_tab(view, first_id) || !find_tab(view, second_id))
    die("closed tab still live");
  revision = view->revision;
  command(&cmd, ORES_BROWSER_CMD_SELECT_TAB, first_id, first_gen);
  status = dispatch(browser, &cmd);
  if (status == ORES_BROWSER_OK) die("stale tab command admitted");
  snapshot(read, browser, view, revision);
  if (view->revision != revision || view->tab_count != 1u)
    die("rejected command mutated browser state");
  command(&cmd, ORES_BROWSER_CMD_SELECT_TAB, second_id, second_gen);
  if (dispatch(browser, &cmd) != ORES_BROWSER_OK)
    die("remaining tab inaccessible");
  snapshot(read, browser, view, revision);
  if (!find_tab(view, second_id) || find_tab(view, second_id)->active != 1u)
    die("remaining tab lost");
  close_session(browser);
  // The retired pointer is never dereferenced by this host test. The real
  // backend must reject it by registry identity before accessing guest state.
  command(&cmd, ORES_BROWSER_CMD_NEW_TAB, 0u, 0u);
  status = dispatch(browser, &cmd);
  if (status == ORES_BROWSER_OK) die("retired session dispatch admitted");
  if (read(browser, view) == ORES_BROWSER_OK)
    die("retired session snapshot admitted");
  snapshot(read, other, view, 0u);
  if (view->tab_count != 0u)
    die("closing first session damaged second session");
  command(&cmd, ORES_BROWSER_CMD_NEW_TAB, 0u, 0u);
  if (dispatch(other, &cmd) != ORES_BROWSER_OK)
    die("second session unusable after first close");
  snapshot(read, other, view, 0u);
  if (view->tab_count != 1u || view->tabs[0].active != 1u)
    die("second session state corrupted by first retirement");
  close_session(other);
  free(view);
  if (dlclose(library) != 0) die("backend dynamic library unload");
  puts("BROWSER_REAL_BACKEND_FFI_PASS independent-sessions malformed-config two-tabs stale-reject snapshot");
  return 0;
}
