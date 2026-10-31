#ifndef ORES_BROWSER_CHROME_TEXT_V1_H
#define ORES_BROWSER_CHROME_TEXT_V1_H

/* Non-authoritative, display-only UTF-16 code-unit filter.
 * Browser-origin parsing and navigation authorization MUST occur in the
 * compiled Oreslang supervisor. This only prevents misleading Qt chrome
 * text; titles are sanitized and URL snapshots fail closed.
 */
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif

static inline int ores_browser_chrome_disallowed_v1(uint16_t u) {
    /* C0/C1, DEL, embedded newlines and bidirectional controls. */
    return u < 0x20u || (u >= 0x7fu && u <= 0x9fu) ||
           u == 0x00adu ||  /* soft hyphen: invisible separator */
           u == 0x034fu ||  /* combining grapheme joiner */
           u == 0x061cu ||  /* Arabic letter mark / bidi */
           u == 0x180eu ||  /* Mongolian vowel separator */
           (u >= 0x200bu && u <= 0x200fu) || /* zero width, LRM/RLM */
           (u >= 0x2028u && u <= 0x202eu) || /* separators, embeddings */
           (u >= 0x2060u && u <= 0x206fu) || /* word joiner, isolates */
           u == 0xfeffu;  /* zero-width no-break space / BOM */
}

#ifdef __cplusplus
}
#endif
#endif
