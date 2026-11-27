// Word → concept evidence from loaded word chunks.
import type { WordsChunk } from './data.ts'
import { isAlphabetic, wordMatch, emojiKey } from './text.ts'

/** A keyword counts this much relative to a word in the concept's own name. */
export const KEYWORD_WEIGHT = 0.5
/** A word that only appears inside longer phrases ("and", "la", "of") counts this much. */
export const FRAGMENT_WEIGHT = 0.25

/** Weight of one packed index entry. */
export const entryWeight = (p: number) => (p & 1 ? KEYWORD_WEIGHT : 1) * (p & 2 ? FRAGMENT_WEIGHT : 1)
const SUBSTRING_QUALITY = 0.7
/** Steepness of the specificity curve: higher punishes common words harder. */
export const SPEC_POWER = 2
const DENSE_SCRIPT = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
const LOGOGRAPHIC = /^\p{Script=Han}+$/u

export interface Locale {
  chunk: WordsChunk
  /** Concept ids, with emoji compared without FE0F (🍽️ and 🍽 are the same concept). */
  concepts: string[]
  keys: string[]
  /** Concept → the words describing it, weighted 1, or FRAGMENT_WEIGHT for words that are never a phrase on their own. */
  bags: Map<string, Map<string, number>>
  /** Word → 0..1, how specific it is: 1 if it describes one concept, near 0 if it describes hundreds. */
  spec: Map<string, number>
  /** First four letters → keys, to find inflected forms without scanning every key. */
  stems: Map<string, string[]>
}

export function prepareLocale(chunk: WordsChunk): Locale {
  const keys = Object.keys(chunk.index)
  const bags = new Map<string, Map<string, number>>()
  const spec = new Map<string, number>()
  const stems = new Map<string, string[]>()
  const concepts = chunk.concepts.map(emojiKey)
  const n = concepts.length
  for (const k of keys) {
    const packed = chunk.index[k]
    spec.set(k, (Math.log(n / new Set(packed.map((p) => p >> 2)).size) / Math.log(n)) ** SPEC_POWER)
    for (const p of packed) {
      const c = concepts[p >> 2]
      const bag = bags.get(c) ?? bags.set(c, new Map()).get(c)!
      bag.set(k, Math.max(bag.get(k) ?? 0, p & 2 ? FRAGMENT_WEIGHT : 1))
    }
    if (k.length >= 4) (stems.get(k.slice(0, 4)) ?? stems.set(k.slice(0, 4), []).get(k.slice(0, 4))!).push(k)
  }
  return { chunk, concepts, keys, bags, spec, stems }
}

/** Keys in this locale that are inflected forms of a word, with match quality (exact excluded). */
export function inflections(word: string, loc: Locale): [string, number][] {
  const out: [string, number][] = []
  for (const k of loc.stems.get(word.slice(0, 4)) ?? []) {
    const q = wordMatch(word, k)
    if (q && q < 1) out.push([k, q])
  }
  return out
}

export interface TokenEvidence {
  /** 0..1, how well the token matched (1 = exact). */
  quality: number
  /** 0..1, how specific the matched words are. Words like "of" or "का" describe hundreds of concepts. */
  spec: number
  /** concept → share, summing to 1. */
  hits: Map<string, number>
  /** Matched keys, for explanations. */
  via: string[]
}

/**
 * Shortest index key that may match inside a longer token (compounds such as "Stromrechnung" ⊃ "strom").
 * A Han character carries meaning alone (药 "medicine" in 药店 "pharmacy"); kana and hangul are syllables.
 */
function substringMin(key: string): number {
  return LOGOGRAPHIC.test(key) ? 1 : DENSE_SCRIPT.test(key) ? 2 : isAlphabetic(key) ? 5 : 3
}

/**
 * Singular and plural of one word: one is the other plus up to two letters ("vegetable"/"vegetables", "cerveza"/"cervezas"),
 * or English y/ies ("grocery"/"groceries"). Not a compound ("hotellnatt"), a derivation ("apotheker") or a lookalike ("petri", "chair").
 */
export function isNumberForm(a: string, b: string): boolean {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  // Short words collide too easily ("chai"/"chair").
  if (short.length < 5) return false
  if (long.startsWith(short)) return long.length - short.length <= 2
  return short.endsWith('y') && long === short.slice(0, -1) + 'ies'
}

/** The token itself and its singular or plural, or [] when the token is not a key here. */
function exactMatches(token: string, loc: Locale): [string, number][] {
  if (!Object.hasOwn(loc.chunk.index, token)) return []
  return [[token, 1], ...inflections(token, loc).filter(([k]) => isNumberForm(token, k))]
}

function matchesIn(token: string, loc: Locale): [string, number][] {
  if (Object.hasOwn(loc.chunk.index, token)) return [[token, 1]]
  const out = inflections(token, loc)
  if (out.length) return out
  for (const k of loc.keys) {
    if (k.length < token.length && k.length >= substringMin(k) && token.includes(k)) {
      out.push([k, SUBSTRING_QUALITY * Math.sqrt(k.length / token.length)])
    }
  }
  return out
}

/**
 * Concept shares for index keys with their match quality: name hits outweigh keyword hits, shares sum to 1.
 * Several keys pool their concepts, so "hotels" (one travel agency) adds to "hotel" (a dozen concepts) without outweighing it.
 */
function keyHits(loc: Locale, keys: [string, number][]): Map<string, number> {
  const m = new Map<string, number>()
  let total = 0
  for (const [k, q] of keys)
    for (const p of loc.chunk.index[k]) {
      const c = loc.concepts[p >> 2]
      m.set(c, Math.max(m.get(c) ?? 0, q * entryWeight(p)))
    }
  for (const w of m.values()) total += w
  for (const [c, w] of m) m.set(c, w / total)
  return m
}

/** Each later locale's evidence counts this much less when a word matches in several (false friends such as fr/en "courses"). */
const LOCALE_PRIOR = 0.5

/** Specificity of one key, lowered when it only ever appears as a keyword or a fragment. */
const keySpec = (loc: Locale, k: string) => loc.spec.get(k)! * Math.max(...loc.chunk.index[k].map(entryWeight))

/** Evidence for one token. Locales are in the app's order of preference. */
export function tokenEvidence(token: string, locales: Locale[]): TokenEvidence | null {
  const hits = new Map<string, number>()
  const via: string[] = []
  let quality = 0
  let spec = 0
  let weightSum = 0
  // An exact match in any locale beats loose matches elsewhere: German "hund" is 🐕, not English "hundred".
  const exactSomewhere = locales.some((loc) => Object.hasOwn(loc.chunk.index, token))
  locales.forEach((loc, i) => {
    const matches = exactSomewhere ? exactMatches(token, loc) : matchesIn(token, loc)
    if (!matches.length) return
    const best = Math.max(...matches.map(([, q]) => q))
    const w = best * LOCALE_PRIOR ** i
    weightSum += w
    quality = Math.max(quality, best)
    if (exactSomewhere) {
      // The token and its singular or plural are one word: one pool of concepts, with the token's own specificity.
      for (const [c, share] of keyHits(loc, matches)) hits.set(c, (hits.get(c) ?? 0) + w * share)
      spec += w * keySpec(loc, token)
      via.push(...matches.map(([k]) => `${loc.chunk.locale}:${k}`))
      return
    }
    // Only the best loose matches count, so a tail of them can't drown the closest.
    const kept = matches.filter(([, q]) => q >= best * 0.9)
    const qSum = kept.reduce((s, [, q]) => s + q, 0)
    for (const [k, q] of kept) {
      for (const [c, share] of keyHits(loc, [[k, 1]])) hits.set(c, (hits.get(c) ?? 0) + w * (q / qSum) * share)
      spec += w * (q / qSum) * keySpec(loc, k)
      via.push(`${loc.chunk.locale}:${k}`)
    }
  })
  if (!weightSum) return null
  for (const [c, w] of hits) hits.set(c, w / weightSum)
  return { quality, spec: spec / weightSum, hits, via }
}
