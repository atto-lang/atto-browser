#ifndef ORES_BROWSER_CHROME_URL_V1_H
#define ORES_BROWSER_CHROME_URL_V1_H
/* Browser chrome only: validate a fixed-capacity, NUL-terminated UTF-8 URL
 * field. This is NOT URL parsing, origin authorization, IDNA canonicalization,
 * a bidi-spoof-proof display, or a replacement for Oreslang policy.
 * The terminator and every remaining byte must be zero. Empty strings are
 * allowed for new-tab snapshots; the command validator rejects empty NAVIGATE.
 */
#include <stddef.h>
#include <stdint.h>

static inline int ores_browser_chrome_url_v1(const char *text, size_t cap) {
  const unsigned char *s = (const unsigned char *)text;
  size_t n = 0u, i;
  if (!s || cap == 0u) return 0;
  while (n < cap && s[n] != 0u) ++n;
  if (n == cap) return 0;
  for (i = n; i < cap; ++i) {
    if (s[i] != 0u) return 0;
  }
  i = 0u;
  while (i < n) {
    uint32_t cp;
    size_t width, j;
    const unsigned char first = s[i];
    if (first < 0x80u) {
      cp = first;
      width = 1u;
    } else if (first >= 0xc2u && first <= 0xdfu) {
      cp = (uint32_t)(first & 0x1fu);
      width = 2u;
    } else if (first >= 0xe0u && first <= 0xefu) {
      cp = (uint32_t)(first & 0x0fu);
      width = 3u;
    } else if (first >= 0xf0u && first <= 0xf4u) {
      cp = (uint32_t)(first & 0x07u);
      width = 4u;
    } else {
      return 0;
    }
    if (width > n - i) return 0;
    for (j = 1u; j < width; ++j) {
      const unsigned char continuation = s[i + j];
      if ((continuation & 0xc0u) != 0x80u) return 0;
      cp = (cp << 6) | (uint32_t)(continuation & 0x3fu);
    }
    /* Reject overlong encodings, surrogates, and beyond Unicode max. */
    if ((width == 2u && cp < 0x80u) ||
        (width == 3u && cp < 0x800u) ||
        (width == 4u && cp < 0x10000u) ||
        (cp >= 0xd800u && cp <= 0xdfffu) || cp > 0x10ffffu)
      return 0;
    /* UI-address spoofing: controls, Bidi reordering, invisible separators. */
    if (cp < 0x20u || (cp >= 0x7fu && cp <= 0x9fu) ||
        cp == 0x00adu || cp == 0x034fu || cp == 0x061cu ||
        cp == 0x180eu || cp == 0x200bu || cp == 0x200eu ||
        cp == 0x200fu || cp == 0x2028u || cp == 0x2029u ||
        (cp >= 0x202au && cp <= 0x202eu) ||
        cp == 0x2060u || (cp >= 0x2066u && cp <= 0x206fu) ||
        cp == 0xfeffu)
      return 0;
    i += width;
  }
  return 1;
}
#endif /* ORES_BROWSER_CHROME_URL_V1_H */
