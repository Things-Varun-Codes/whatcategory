// Language-agnostic text handling shared by the runtime and the data build.

const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' })
const FOLDABLE = /(\p{Script=Latin}|\p{Script=Greek}|\p{Script=Cyrillic})\p{M}+/gu
const ALPHABETIC = /^[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{M}]+$/u

/** NFKC, lowercase, and diacritics removed for Latin, Greek and Cyrillic only (other scripts need their marks). */
export function fold(s: string): string {
  return s.normalize('NFKC').toLowerCase().normalize('NFD').replace(FOLDABLE, '$1').normalize('NFC')
}

/** Folded word tokens. Intl.Segmenter handles scripts without spaces (ja, zh, th). */
export function tokens(s: string): string[] {
  const out: string[] = []
  for (const seg of segmenter.segment(fold(s))) {
    if (!seg.isWordLike) continue
    // "l'aéroport" → "l", "aéroport": elided articles and possessives are separate words in practice.
    for (const part of seg.segment.split(/['’]/)) if (part) out.push(part)
  }
  return out
}

/** Key for exact name matching: folded, letters, marks and digits only. */
export function nameKey(s: string): string {
  return fold(s).replace(/[^\p{L}\p{M}\p{N}]+/gu, '')
}

/** True for words in alphabetic scripts, where inflection makes prefix matching useful. */
export function isAlphabetic(token: string): boolean {
  return ALPHABETIC.test(token)
}

/** Emoji without variation selectors, so 🍽️ and 🍽 compare equal. */
export function emojiKey(e: string): string {
  return e.replace(/️/g, '')
}

const PREFIX_QUALITY = 0.85

/**
 * How well two folded words match: 1 if equal, less for inflected forms of an alphabetic word
 * ("grocery"/"groceries", "shop"/"shopping", "cerveza"/"cervezas"), 0 otherwise.
 * The shared start must be at least 4 letters, 70% of the shorter word and half of the longer one,
 * which keeps "super" from matching "supermarket".
 */
export function wordMatch(a: string, b: string): number {
  if (a === b) return 1
  const short = Math.min(a.length, b.length)
  const long = Math.max(a.length, b.length)
  if (short < 4 || !isAlphabetic(a) || !isAlphabetic(b)) return 0
  let n = 0
  while (n < short && a[n] === b[n]) n++
  return n >= 4 && n >= 0.7 * short && n >= 0.5 * long ? PREFIX_QUALITY * Math.sqrt(n / long) : 0
}
