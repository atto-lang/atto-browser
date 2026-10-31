/* Portable, always-on Release-mode chrome anti-spoofing test.
 * The same predicate is called for Qt address-bar URL rejection and for
 * untrusted webpage title sanitization. This is NOT URL canonicalization.
 */
#include "ores_browser_chrome_text_v1.h"
#include <stdint.h>
#include <stddef.h>
#include <stdio.h>

#define CHECK(x) do { if (!(x)) { \
    fprintf(stderr, "CHROME_TEXT_FILTER_FAIL:%d:%s\n", __LINE__, #x); \
    return 1; \
} } while (0)

int main(void) {
    static const uint16_t controls[] = {
        0u, 9u, 10u, 13u, 31u, 0x7fu, 0x80u, 0x9fu,
        0xadu, 0x34fu, 0x61cu, 0x180eu,
        0x200bu, 0x200cu, 0x200du, 0x200eu, 0x200fu,
        0x2028u, 0x2029u, 0x202au, 0x202bu,
        0x202cu, 0x202du, 0x202eu,
        0x2060u, 0x2061u, 0x2065u, 0x2066u,
        0x2067u, 0x2068u, 0x2069u, 0x206au, 0x206fu,
        0xfeffu
    };
    static const uint16_t allowed[] = {
        0x20u, 'a', ':', '/', '.', '?', '#', '%',
        0x00a9u, 0x34eu, 0x61bu, 0x61du, 0x180du,
        0x200au, 0x2010u, 0x2027u, 0x202fu,
        0x205fu, 0x2070u, 0xfeffu - 1u,
        0xd83du, 0xde00u  /* valid pair: checkedUTF8 ensures pairing */
    };
    size_t i;
    for (i = 0; i < sizeof controls / sizeof controls[0]; ++i) {
        CHECK(ores_browser_chrome_disallowed_v1(controls[i]));
    }
    for (i = 0; i < sizeof allowed / sizeof allowed[0]; ++i) {
        CHECK(!ores_browser_chrome_disallowed_v1(allowed[i]));
    }
    /* Exhaustively verify every code unit against an independent interval
     * table, including holes and every endpoint. */
    {
        static const struct { uint16_t lo, hi; } ranges[] = {
            {0u, 31u}, {0x7fu, 0x9fu}, {0x00adu, 0x00adu},
            {0x034fu, 0x034fu}, {0x061cu, 0x061cu},
            {0x180eu, 0x180eu}, {0x200bu, 0x200fu},
            {0x2028u, 0x202eu}, {0x2060u, 0x206fu},
            {0xfeffu, 0xfeffu}
        };
        uint32_t cp;
        for (cp = 0u; cp <= UINT16_MAX; ++cp) {
            int expected = 0;
            for (i = 0; i < sizeof ranges / sizeof ranges[0]; ++i) {
                if (cp >= ranges[i].lo && cp <= ranges[i].hi) expected = 1;
            }
            CHECK(ores_browser_chrome_disallowed_v1((uint16_t)cp) == expected);
        }
    }
    puts("CHROME_TEXT_65536_UNIT_POLICY_PASS (host only; no Qt/Oreslang guest)");
    return 0;
}
