// Word → concept evidence from loaded word chunks.
import type { WordsChunk } from './data.ts'
import { isAlphabetic, wordMatch } from './text.ts'

/** A keyword counts this much relative to a word in the concept's own name. */
export const KEYWORD_WEIGHT = 0.5
const SUBSTRING_QUALITY = 0.7
const DENSE_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u

export interface Locale {
  chunk: WordsChunk
  keys: string[]
  /** Concept → its describing words, weighted by name/keyword and by how specific the word is. */
  bags: Map<string, Map<string, number>>
}

export function prepareLocale(chunk: WordsChunk): Locale {
  const keys = Object.keys(chunk.index)
  const bags = new Map<string, Map<string, number>>()
  const n = chunk.concepts.length
  for (const k of keys) {
    const packed = chunk.index[k]
    const idf = Math.log(n / new Set(packed.map((p) => p >> 1)).size) / Math.log(n)
    for (const p of packed) {
      const c = chunk.concepts[p >> 1]
      const bag = bags.get(c) ?? bags.set(c, new Map()).get(c)!
      bag.set(k, Math.max(bag.get(k) ?? 0, (p & 1 ? KEYWORD_WEIGHT : 1) * idf))
    }
  }
  return { chunk, keys, bags }
}

export interface TokenEvidence {
  /** 0..1, how well the token matched (1 = exact). */
  quality: number
  /** concept → share, summing to 1. */
  hits: Map<string, number>
  /** Matched keys, for explanations. */
  via: string[]
}

/** Shortest index key that may match inside a longer token (compounds such as "Stromrechnung" ⊃ "strom"). */
function substringMin(key: string): number {
  return DENSE_SCRIPT.test(key) ? 2 : isAlphabetic(key) ? 5 : 3
}

function matchesIn(token: string, loc: Locale): [string, number][] {
  if (Object.hasOwn(loc.chunk.index, token)) return [[token, 1]]
  const out: [string, number][] = []
  for (const k of loc.keys) {
    const q = wordMatch(token, k)
    if (q) out.push([k, q])
  }
  if (out.length) return out
  for (const k of loc.keys) {
    if (k.length < token.length && k.length >= substringMin(k) && token.includes(k)) {
      out.push([k, SUBSTRING_QUALITY * Math.sqrt(k.length / token.length)])
    }
  }
  return out
}

/** Concept shares for one index key: name hits outweigh keyword hits, shares sum to 1. */
function keyHits(loc: Locale, key: string): Map<string, number> {
  const m = new Map<string, number>()
  let total = 0
  for (const p of loc.chunk.index[key]) {
    const w = p & 1 ? KEYWORD_WEIGHT : 1
    const c = loc.chunk.concepts[p >> 1]
    m.set(c, Math.max(m.get(c) ?? 0, w))
  }
  for (const w of m.values()) total += w
  for (const [c, w] of m) m.set(c, w / total)
  return m
}

export function tokenEvidence(token: string, locales: Locale[]): TokenEvidence | null {
  const hits = new Map<string, number>()
  const via: string[] = []
  let quality = 0
  let weightSum = 0
  for (const loc of locales) {
    const matches = matchesIn(token, loc)
    if (!matches.length) continue
    const best = Math.max(...matches.map(([, q]) => q))
    // Only the best matches in this locale count, so a tail of loose matches can't drown an exact one.
    const kept = matches.filter(([, q]) => q >= best * 0.9)
    const qSum = kept.reduce((s, [, q]) => s + q, 0)
    for (const [k, q] of kept) {
      for (const [c, share] of keyHits(loc, k)) hits.set(c, (hits.get(c) ?? 0) + best * (q / qSum) * share)
      via.push(`${loc.chunk.locale}:${k}`)
    }
    weightSum += best
    quality = Math.max(quality, best)
  }
  if (!weightSum) return null
  for (const [c, w] of hits) hits.set(c, w / weightSum)
  return { quality, hits, via }
}
