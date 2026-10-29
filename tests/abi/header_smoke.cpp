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
    return config.abi_version == 1u &&
           ores_browser_validate_command_v1(&cmd) ? 0 : 1;
}
