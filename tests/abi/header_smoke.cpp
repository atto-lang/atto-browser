#include "ores_browser_wire_validate_v1.h"
#include <type_traits>
#include <cstddef>
static_assert(ORES_BROWSER_UI_ABI_VERSION == 1u);
static_assert(std::is_standard_layout_v<OresBrowserSnapshot>);
static_assert(std::is_trivially_copyable_v<OresBrowserCommand>);
static_assert(sizeof(OresBrowserConfig) == 16);
static_assert(sizeof(OresBrowserCommand) == 2072);
static_assert(offsetof(OresBrowserCommand, url) == 24);
static_assert(sizeof(OresBrowserTabView) == 2240);
static_assert(offsetof(OresBrowserSnapshot, tabs) == 24);
static_assert(sizeof(OresBrowserSnapshot) == 143384);
int main() {
    OresBrowserConfig config{};
    config.struct_size = sizeof(config);
    config.abi_version = ORES_BROWSER_UI_ABI_VERSION;
    OresBrowserCommand cmd{};
    cmd.struct_size = sizeof(cmd);
    cmd.operation = ORES_BROWSER_CMD_NEW_TAB;
    if (!ores_browser_validate_config_v1(&config) ||
        !ores_browser_validate_command_v1(&cmd))
        return 1;
    cmd.url[0] = 'h';
    cmd.url[1] = 0;
    if (!ores_browser_validate_command_v1(&cmd))
        return 2; // Optional initial URL for NEW_TAB.
    cmd.url[100] = 'X';
    if (ores_browser_validate_command_v1(&cmd))
        return 3; // Noncanonical padding must fail.
    config.reserved = 1u;
    if (ores_browser_validate_config_v1(&config))
        return 4;
    return 0;
}
