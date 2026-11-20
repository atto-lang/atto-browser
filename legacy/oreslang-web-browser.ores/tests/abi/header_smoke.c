#include "ores_browser_ui_abi_v1.h"
#include <stddef.h>
_Static_assert(ORES_BROWSER_UI_ABI_VERSION == 1u, "unexpected ABI");
_Static_assert(ORES_BROWSER_MAX_TABS == 64u, "unexpected tab limit");
_Static_assert(sizeof(OresBrowserConfig) == 16, "config size");
_Static_assert(sizeof(OresBrowserCommand) == 2072, "command size");
_Static_assert(offsetof(OresBrowserCommand, url) == 24, "command URL offset");
_Static_assert(sizeof(OresBrowserTabView) == 2240, "tab record size");
_Static_assert(offsetof(OresBrowserSnapshot, tabs) == 24, "snapshot tab offset");
_Static_assert(sizeof(OresBrowserSnapshot) == 143384, "snapshot size");
_Static_assert(sizeof(((OresBrowserCommand*)0)->url) == 2048u, "URL bytes");
int main(void) {
    OresBrowserCommand cmd = {0};
    cmd.struct_size = sizeof(cmd);
    cmd.operation = ORES_BROWSER_CMD_NEW_TAB;
    return cmd.operation == 1 ? 0 : 1;
}
