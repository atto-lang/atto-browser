/* Executed host-only test: chrome URL wire encoding, not browser origin policy. */
#include "ores_browser_wire_validate_v1.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define CHECK(cond, label) do { if (!(cond)) { \
  fprintf(stderr, "FAIL:chrome-url:%s\n", label); free(snap); return 1; \
} } while (0)

int main(void) {
  char url[ORES_BROWSER_URL_BYTES] = {0};
  OresBrowserCommand cmd = {0};
  OresBrowserSnapshot *snap = (OresBrowserSnapshot*)calloc(1, sizeof(*snap));
  const char *bad[] = {
    "https://test.invalid/\xE2\x80\x8E" /* LRM */,
    "https://test.invalid/\xE2\x80\x8F" /* RLM */,
    "https://test.invalid/\xD8\x9C"     /* Arabic Letter Mark */,
    "https://test.invalid/\xE2\x80\xAE" /* RTL override */,
    "https://test.invalid/\xE2\x81\xA6" /* bidi isolate */,
    "https://test.invalid/\xE2\x81\xA0" /* word joiner */,
    "https://test.invalid/\xE2\x80\x8B" /* zero-width space */,
    "https://test.invalid/\xEF\xBB\xBF" /* BOM */,
    "https://test.invalid/\xC0\xAF"     /* overlong */,
    "https://test.invalid/\xED\xA0\x80" /* surrogate */,
    "https://test.invalid/\xF4\x90\x80\x80" /* beyond U+10FFFF */,
    "https://test.invalid/\xC2\x85"     /* C1 control */,
    "https://test.invalid/\xE2\x80\xA8" /* line separator */,
    "https://test.invalid/\xF0\x9F\x98" /* incomplete 4-byte */
  };
  size_t i;
  if (!snap) return 2;
  strcpy(url, "https://example.com/ok");
  CHECK(ores_browser_chrome_url_v1(url, sizeof(url)), "ascii-valid");
  strcpy(url, "https://example.com/\xE9\x9B\xAA"); /* CJK valid UTF8 */
  CHECK(ores_browser_chrome_url_v1(url, sizeof(url)), "unicode-valid");
  memset(url, 0, sizeof(url));
  CHECK(ores_browser_chrome_url_v1(url, sizeof(url)), "empty-snapshot");
  CHECK(!ores_browser_chrome_url_v1(NULL, sizeof(url)), "null");
  CHECK(!ores_browser_chrome_url_v1(url, 0), "zero-capacity");
  memset(url, 'x', sizeof(url));
  CHECK(!ores_browser_chrome_url_v1(url, sizeof(url)), "missing-terminator");
  memset(url, 0, sizeof(url));
  strcpy(url, "https://example.com/");
  url[99] = 'x';
  CHECK(!ores_browser_chrome_url_v1(url, sizeof(url)), "noncanonical-tail");
  url[99] = 0;
  cmd.struct_size = (uint32_t)sizeof(cmd);
  cmd.operation = ORES_BROWSER_CMD_NAVIGATE;
  cmd.tab_id = 17;
  cmd.tab_generation = 4;
  strcpy(cmd.url, "https://example.com/");
  CHECK(ores_browser_validate_command_v1(&cmd), "valid-nav");
  snap->struct_size = (uint32_t)sizeof(*snap);
  snap->abi_version = ORES_BROWSER_UI_ABI_VERSION;
  snap->revision = 1;
  snap->tab_count = 1;
  snap->tabs[0].tab_id = 17;
  snap->tabs[0].generation = 4;
  snap->tabs[0].active = 1;
  strcpy(snap->tabs[0].display_url, "https://example.com/");
  CHECK(ores_browser_validate_snapshot_v1(snap, 0, 0), "valid-snapshot");
  for (i = 0; i < sizeof(bad) / sizeof(bad[0]); ++i) {
    memset(cmd.url, 0, sizeof(cmd.url));
    strcpy(cmd.url, bad[i]);
    CHECK(!ores_browser_validate_command_v1(&cmd), "bad-nav");
    memset(snap->tabs[0].display_url, 0, sizeof(snap->tabs[0].display_url));
    strcpy(snap->tabs[0].display_url, bad[i]);
    CHECK(!ores_browser_validate_snapshot_v1(snap, 0, 0), "bad-snapshot");
  }
  memset(cmd.url, 0, sizeof(cmd.url));
  strcpy(cmd.url, "https://example.com/\tbad");
  CHECK(!ores_browser_validate_command_v1(&cmd), "tab-control");
  free(snap);
  puts("BROWSER_CHROME_URL_HOST_PASS (NOT origin authorization)");
  return 0;
}
