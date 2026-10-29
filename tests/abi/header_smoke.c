#include "ores_browser_ui_abi_v1.h"
#include <stddef.h>
_Static_assert(ORES_BROWSER_UI_ABI_VERSION == 1u, "unexpected ABI");
_Static_assert(ORES_BROWSER_MAX_TABS == 64u, "unexpected tab limit");
_Static_assert(offsetof(OresBrowserSnapshot, tabs) > 0, "missing tabs");
_Static_assert(sizeof(((OresBrowserCommand*)0)->url) == 2048u, "URL bytes");
int main(void) {
    OresBrowserCommand cmd = {0};
    cmd.struct_size = sizeof(cmd);
    cmd.operation = ORES_BROWSER_CMD_NEW_TAB;
    return cmd.operation == 1 ? 0 : 1;
}
