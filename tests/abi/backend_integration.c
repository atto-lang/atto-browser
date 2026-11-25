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
  OresBrowserHandle *other_browser = NULL;
  OresBrowserCommand cmd = {0};
  OresBrowserSnapshot *view;
  OresBrowserSnapshot *other_view;
  uint64_t revision, first_id, first_gen, second_id, second_gen;
  uint64_t other_revision, other_tab_id, other_tab_gen;
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
  /* Invalid host config must fail before an actor/session is allocated. */
  {
    OresBrowserConfig malformed = config;
    OresBrowserHandle *unexpected = NULL;
    malformed.struct_size = (uint32_t)sizeof(config) - 1u;
    if (open_session(&malformed, &unexpected) == ORES_BROWSER_OK ||
        unexpected != NULL)
      die("undersized config created a session");
    malformed = config;
    malformed.abi_version = ORES_BROWSER_UI_ABI_VERSION + 1u;
    unexpected = NULL;
    if (open_session(&malformed, &unexpected) == ORES_BROWSER_OK ||
        unexpected != NULL)
      die("unsupported config version created a session");
    malformed = config;
    malformed.private_session = 2u;
    unexpected = NULL;
    if (open_session(&malformed, &unexpected) == ORES_BROWSER_OK ||
        unexpected != NULL)
      die("nonboolean private-session flag created a session");
    malformed = config;
    malformed.reserved = 1u;
    unexpected = NULL;
    if (open_session(&malformed, &unexpected) == ORES_BROWSER_OK ||
        unexpected != NULL)
      die("nonzero reserved config created a session");
  }
  if (open_session(&config, &browser) != ORES_BROWSER_OK || !browser)
    die("backend open (requires trusted fresh test session)");
  if (open_session(&config, &other_browser) != ORES_BROWSER_OK ||
      !other_browser || other_browser == browser)
    die("backend failed to create an independent session handle");
  view = (OresBrowserSnapshot*)calloc(1u, sizeof(*view));
  other_view = (OresBrowserSnapshot*)calloc(1u, sizeof(*other_view));
  if (!view || !other_view) die("test allocation");
  snapshot(read, other_browser, other_view, 0u);
  if (other_view->tab_count != 0u) die("other session not initially empty");
  other_revision = other_view->revision;
  snapshot(read, browser, view, 0u);
  if (view->tab_count != 0u) die("test session must start with zero tabs");
  revision = view->revision;
  /* Rejected wire commands may never mutate the actor-owned revision. */
  command(&cmd, ORES_BROWSER_CMD_NEW_TAB, 0u, 0u);
  cmd.struct_size--;
  if (dispatch(browser, &cmd) == ORES_BROWSER_OK)
    die("undersized command accepted");
  command(&cmd, ORES_BROWSER_CMD_NEW_TAB, 0u, 0u);
  cmd.operation = 999u;
  if (dispatch(browser, &cmd) == ORES_BROWSER_OK)
    die("unknown operation accepted");
  command(&cmd, ORES_BROWSER_CMD_NEW_TAB, 0u, 0u);
  cmd.tab_id = 77u;
  if (dispatch(browser, &cmd) == ORES_BROWSER_OK)
    die("new-tab identity smuggling admitted");
  command(&cmd, ORES_BROWSER_CMD_NEW_TAB, 0u, 0u);
  memset(cmd.url, 'X', sizeof(cmd.url));
  if (dispatch(browser, &cmd) == ORES_BROWSER_OK)
    die("unterminated new-tab URL admitted");
  snapshot(read, browser, view, revision);
  if (view->revision != revision || view->tab_count != 0u)
    die("invalid command mutated empty browser");
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
  /* NEXT/PREVIOUS are session-scoped: both tab identity fields are zero.
   * They must move focus among tabs without creating or losing a tab.
   */
  revision = view->revision;
  command(&cmd, ORES_BROWSER_CMD_NEXT_TAB, 0u, 0u);
  if (dispatch(browser, &cmd) != ORES_BROWSER_OK)
    die("session-level next tab rejected");
  snapshot(read, browser, view, revision);
  if (view->revision <= revision || view->tab_count != 2u ||
      !find_tab(view, first_id) || find_tab(view, first_id)->active != 1u)
    die("session next tab did not rotate to first");
  revision = view->revision;
  command(&cmd, ORES_BROWSER_CMD_PREVIOUS_TAB, 0u, 0u);
  if (dispatch(browser, &cmd) != ORES_BROWSER_OK)
    die("session-level previous tab rejected");
  snapshot(read, browser, view, revision);
  if (view->revision <= revision || view->tab_count != 2u ||
      !find_tab(view, second_id) || find_tab(view, second_id)->active != 1u)
    die("session previous tab did not rotate to second");
  // Two tabs in one session must not leak into an independent window.
  snapshot(read, other_browser, other_view, other_revision);
  if (other_view->tab_count != 0u || other_view->revision != other_revision)
    die("first session mutated the second session");
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
  // Each session has its own actor-owned lifecycle and revision ledger.
  // A tab created in the other session cannot affect the original session.
  revision = view->revision;
  command(&cmd, ORES_BROWSER_CMD_NEW_TAB, 0u, 0u);
  if (dispatch(other_browser, &cmd) != ORES_BROWSER_OK)
    die("other session cannot create an independent tab");
  snapshot(read, other_browser, other_view, other_revision);
  if (other_view->tab_count != 1u ||
      other_view->revision <= other_revision)
    die("other session tab creation lost");
  other_tab_id = other_view->tabs[0].tab_id;
  other_tab_gen = other_view->tabs[0].generation;
  snapshot(read, browser, view, revision);
  if (view->revision != revision || view->tab_count != 1u ||
      !find_tab(view, second_id))
    die("other session mutated original browser");
  // A generation-mismatched command is never a valid tab capability.
  other_revision = other_view->revision;
  command(&cmd, ORES_BROWSER_CMD_SELECT_TAB, other_tab_id, other_tab_gen);
  cmd.tab_generation = other_tab_gen == UINT64_MAX ? other_tab_gen - 1u
                                                       : other_tab_gen + 1u;
  if (dispatch(other_browser, &cmd) == ORES_BROWSER_OK)
    die("generation-mismatched tab command admitted");
  snapshot(read, other_browser, other_view, other_revision);
  if (other_view->revision != other_revision || other_view->tab_count != 1u)
    die("stale generation mutated other session");
  close_session(other_browser);
  // Closing the other browser must not retire the surviving session.
  snapshot(read, browser, view, revision);
  if (view->revision != revision || view->tab_count != 1u ||
      !find_tab(view, second_id))
    die("closing other session mutated surviving session");
  close_session(browser);
  free(other_view);
  free(view);
  if (dlclose(library) != 0) die("backend dynamic library unload");
  puts("BROWSER_REAL_BACKEND_FFI_PASS two-tabs two-sessions stale-generation");
  return 0;
}
