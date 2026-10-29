#include "ores_browser_ui_abi_v1.h"
#include <type_traits>
static_assert(ORES_BROWSER_UI_ABI_VERSION == 1u);
static_assert(std::is_standard_layout_v<OresBrowserSnapshot>);
static_assert(std::is_trivially_copyable_v<OresBrowserCommand>);
int main() {
    OresBrowserConfig config{};
    config.struct_size = sizeof(config);
    config.abi_version = ORES_BROWSER_UI_ABI_VERSION;
    return (config.abi_version == 1u) ? 0 : 1;
}
