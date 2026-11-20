#ifndef ORES_BROWSER_UI_ABI_V1_H
#define ORES_BROWSER_UI_ABI_V1_H
/* V1 FFI contract: Oreslang owns all browser/tab/tenant/notification state.
 * A trusted AOT Oreslang backend exports these exact C symbols.
 * Qt/C++ forwards commands and renders snapshots only.
 * No raw Oreslang pointers, Qt objects, or native OS handles cross this ABI.
 * This is a PROPOSED ABI, not evidence of compiler export support.
 */
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
#define ORES_BROWSER_UI_ABI_VERSION 1u
#define ORES_BROWSER_MAX_TABS 64u
#define ORES_BROWSER_URL_BYTES 2048u
#define ORES_BROWSER_TITLE_BYTES 160u

typedef struct OresBrowserHandle OresBrowserHandle;
typedef enum OresBrowserStatus {
  ORES_BROWSER_OK = 0,
  ORES_BROWSER_INVALID = 1,
  ORES_BROWSER_DENIED = 2,
  ORES_BROWSER_STALE = 3,
  ORES_BROWSER_BUSY = 4,
  ORES_BROWSER_UNSUPPORTED = 5,
  ORES_BROWSER_INTERNAL = 6
} OresBrowserStatus;
typedef enum OresBrowserCommandKind {
  ORES_BROWSER_CMD_NEW_TAB = 1,
  ORES_BROWSER_CMD_SELECT_TAB = 2,
  ORES_BROWSER_CMD_CLOSE_TAB = 3,
  ORES_BROWSER_CMD_NAVIGATE = 4,
  ORES_BROWSER_CMD_BACK = 5,
  ORES_BROWSER_CMD_FORWARD = 6,
  ORES_BROWSER_CMD_RELOAD = 7,
  ORES_BROWSER_CMD_NEXT_TAB = 8,
  ORES_BROWSER_CMD_PREVIOUS_TAB = 9
} OresBrowserCommandKind;

/* Every header version is checked before reading any subsequent bytes.
 * Host-provided IDs are bootstrapped by privileged application launch,
 * never by renderer input. Reserved fields must be zero.
 */
typedef struct OresBrowserConfig {
  uint32_t struct_size;
  uint32_t abi_version;
  /* Host selects a signed/authorized profile; UI never chooses tenant IDs. */
  uint32_t private_session;
  uint32_t reserved;
} OresBrowserConfig;

typedef struct OresBrowserCommand {
  uint32_t struct_size;
  uint32_t operation;
  uint64_t tab_id;
  uint64_t tab_generation;
  /* UTF-8, NUL terminated, <= 2047 bytes. Relevant to NAVIGATE/NEW_TAB.
   * The Oreslang browser supervisor MUST canonicalize and authorize it;
   * Qt must not perform security-sensitive origin parsing.
   */
  char url[ORES_BROWSER_URL_BYTES];
} OresBrowserCommand;

typedef struct OresBrowserTabView {
  uint64_t tab_id;
  uint64_t generation;
  uint32_t active;
  uint32_t can_go_back;
  uint32_t can_go_forward;
  uint32_t loading;
  char title[ORES_BROWSER_TITLE_BYTES];
  char display_url[ORES_BROWSER_URL_BYTES];
} OresBrowserTabView;

typedef struct OresBrowserSnapshot {
  uint32_t struct_size;
  uint32_t abi_version;
  uint64_t revision;
  uint32_t tab_count;
  uint32_t reserved;
  OresBrowserTabView tabs[ORES_BROWSER_MAX_TABS];
} OresBrowserSnapshot;

/* Called exclusively on a dedicated non-UI bridge thread.
 * Returned result must be OresBrowserStatus, never an arbitrary int.
 * Exporter implementation and Oreslang actor message pump pending.
 */
uint32_t ores_browser_abi_version(void);
int32_t ores_browser_open(const OresBrowserConfig *config,
                          OresBrowserHandle **out_browser);
int32_t ores_browser_dispatch(OresBrowserHandle *browser,
                              const OresBrowserCommand *command);
int32_t ores_browser_snapshot(OresBrowserHandle *browser,
                              OresBrowserSnapshot *out_snapshot);
void ores_browser_close(OresBrowserHandle *browser);
#ifdef __cplusplus
}
#endif
#endif /* ORES_BROWSER_UI_ABI_V1_H */
