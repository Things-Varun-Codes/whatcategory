import type { Chunk, BrandsChunk } from './data.ts'
import { tokens, nameKey, emojiKey, wordMatch, fold } from './text.ts'
import { prepareLocale, tokenEvidence, type Locale } from './words.ts'

export type { Chunk, WordsChunk, BrandsChunk } from './data.ts'
export { tokens, fold } from './text.ts'

/** One of the app's categories. Give an emoji, words in any language, or both. */
export interface Category {
  id: string
  emoji?: string
  words?: string[]
}

/** A past choice. `at` is any increasing number (e.g. Date.now()); later entries win when absent. */
export interface HistoryEntry {
  title: string
  categoryId: string
  at?: number
}

export interface Reason {
  /** history: an earlier choice; words: CLDR or place words; brand: a brand or operator name; category: the category's own words. */
  layer: 'history' | 'words' | 'brand' | 'category'
  /** The part of the title that matched. */
  text: string
  /** What it matched: an emoji, an OSM place type, a past title, or a category word. */
  match: string
  weight: number
}

export interface Suggestion {
  id: string
  /** 0..1. */
  confidence: number
  why: Reason[]
}

export interface Options {
  categories: Category[]
  /** Data chunks from `whatcategory/words/<locale>` and `whatcategory/brands/<COUNTRY>`. */
  data: Chunk[]
  /** Below this confidence `suggest` returns null. */
  threshold?: number
}

export interface Classifier {
  /** Best category for a title, or null when unsure. Pass the app's saved history to learn from it. */
  suggest(title: string, history?: readonly HistoryEntry[]): Suggestion | null
  /** All categories with some evidence, best first. */
  rank(title: string, history?: readonly HistoryEntry[]): Suggestion[]
}

export const DEFAULT_THRESHOLD = 0.3
/** Each later word counts a little less, so the first concept in "Taxi to hotel" wins a tie. */
const POSITION_DECAY = 0.15
/** A brand name counts this much relative to a word; the whole title being a brand counts more. */
const BRAND_WEIGHT = 1.5
const WHOLE_TITLE_BRAND_WEIGHT = 3
/** Brand names that are also ordinary words ("Bio", "Dia") are weaker evidence. */
const BRAND_IS_WORD_FACTOR = 0.3
/** Trust in each NSI source: brands, transit networks, operators (operators also run toilets, cameras, poles). */
const SOURCE_TRUST = [1, 0.6, 0.15]
const HISTORY_SIMILAR_WEIGHT = 0.9
const MAX_NGRAM = 4

interface Evidence {
  /** concept → share (sums to 1), or direct category matches. */
  hits: Map<string, number>
  direct: Map<string, number>
  mass: number
  reason: Omit<Reason, 'weight'>
}

export function createClassifier(options: Options): Classifier {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD
  const locales: Locale[] = []
  const brands: BrandsChunk[] = []
  for (const c of options.data) c.kind === 'words' ? locales.push(prepareLocale(c)) : brands.push(c)

  // Every word a category is described by, with how strongly: its own words fully, the words of its anchor
  // concepts (its emoji, and concepts its words name) in proportion to how directly they were named.
  const categories = options.categories.map((cat) => {
    const words = (cat.words ?? []).flatMap(tokens)
    const anchors = new Map<string, number>()
    if (cat.emoji) anchors.set(emojiKey(cat.emoji), 1)
    for (const w of words) {
      const ev = tokenEvidence(w, locales)
      if (ev) for (const c of ev.hits.keys()) anchors.set(c, Math.max(anchors.get(c) ?? 0, ev.quality))
    }
    const described = new Map<string, number>()
    const put = (w: string, s: number) => described.set(w, Math.max(described.get(w) ?? 0, s))
    for (const w of words) put(w, 1)
    for (const [c, s] of anchors) for (const loc of locales) for (const w of loc.bags.get(c)?.keys() ?? []) put(w, s)
    // Inflected forms of the category's own words count too ("grocery" describes a category called "Groceries").
    const expanded = new Map(described)
    for (const w of words)
      for (const loc of locales)
        for (const k of loc.keys) {
          const q = wordMatch(w, k)
          if (q && q < 1) expanded.set(k, Math.max(expanded.get(k) ?? 0, q))
        }
    return { id: cat.id, words, anchors, described: expanded }
  })

  const simCache = new Map<string, number[]>()
  /** How strongly each category covers a concept: 1 for an anchor, else the share of the concept's words it uses. */
  function conceptLinks(concept: string): number[] {
    let links = simCache.get(concept)
    if (links) return links
    links = categories.map((cat) => {
      let total = 0
      let covered = 0
      for (const loc of locales)
        for (const [w, s] of loc.bags.get(concept) ?? []) {
          total += s
          covered += s * (cat.described.get(w) ?? 0)
        }
      return Math.max(cat.anchors.get(concept) ?? 0, total ? covered / total : 0)
    })
    simCache.set(concept, links)
    return links
  }

  const isWord = (key: string) => locales.some((l) => Object.hasOwn(l.chunk.index, key))

  function brandEvidence(text: string, whole: boolean): Evidence | null {
    const key = nameKey(text)
    const hits = new Map<string, number>()
    for (const b of brands) {
      if (!Object.hasOwn(b.names, key)) continue
      for (const p of b.names[key]) {
        const place = b.places[p >> 2]
        hits.set(place, Math.max(hits.get(place) ?? 0, SOURCE_TRUST[p & 3]))
      }
    }
    if (!hits.size) return null
    const total = [...hits.values()].reduce((a, b) => a + b, 0)
    for (const [c, w] of hits) hits.set(c, w / total)
    const best = [...hits].sort((a, b) => b[1] - a[1])[0][0]
    const mass = (whole ? WHOLE_TITLE_BRAND_WEIGHT : BRAND_WEIGHT) * (isWord(key) ? BRAND_IS_WORD_FACTOR : 1)
    return { hits, direct: new Map(), mass, reason: { layer: 'brand', text, match: best } }
  }

  function evidence(title: string): Evidence[] {
    const toks = tokens(title)
    const out: Evidence[] = []
    let i = 0
    let position = 0
    while (i < toks.length) {
      const weight = 1 / (1 + POSITION_DECAY * position++)
      // Longest brand name starting here wins over its individual words.
      let brand: Evidence | null = null
      let n = Math.min(MAX_NGRAM, toks.length - i)
      for (; n > 0 && brands.length; n--) {
        brand = brandEvidence(toks.slice(i, i + n).join(' '), n === toks.length)
        if (brand) break
      }
      if (brand) {
        brand.mass *= weight
        out.push(brand)
        i += n
        continue
      }
      const t = toks[i++]
      const direct = new Map<string, number>()
      categories.forEach((cat) => {
        const q = Math.max(0, ...cat.words.map((w) => wordMatch(t, w)))
        if (q) direct.set(cat.id, q)
      })
      const ev = tokenEvidence(t, locales)
      if (!ev && !direct.size) continue
      const quality = Math.max(ev?.quality ?? 0, ...direct.values())
      const top = ev && [...ev.hits].sort((a, b) => b[1] - a[1])[0][0]
      out.push({
        hits: ev?.hits ?? new Map(),
        direct,
        mass: weight * quality,
        reason: direct.size ? { layer: 'category', text: t, match: [...direct.keys()][0] } : { layer: 'words', text: t, match: top! },
      })
    }
    return out
  }

  function scoreData(title: string): Suggestion[] {
    const evs = evidence(title)
    const totalMass = evs.reduce((s, e) => s + e.mass, 0)
    if (!totalMass) return []
    const scores = categories.map(() => 0)
    const why: Reason[][] = categories.map(() => [])
    for (const ev of evs) {
      const contrib = categories.map(() => 0)
      for (const [concept, share] of ev.hits) conceptLinks(concept).forEach((l, ci) => (contrib[ci] += share * l))
      categories.forEach((cat, ci) => {
        contrib[ci] = Math.max(contrib[ci], ev.direct.get(cat.id) ?? 0)
        if (contrib[ci] > 0) {
          scores[ci] += ev.mass * contrib[ci]
          why[ci].push({ ...ev.reason, weight: +(ev.mass * contrib[ci]).toFixed(3) })
        }
      })
    }
    return categories
      .map((cat, ci) => ({ id: cat.id, confidence: +(scores[ci] / totalMass).toFixed(3), why: why[ci] }))
      .filter((s) => s.confidence > 0)
      .sort((a, b) => b.confidence - a.confidence)
  }

  function scoreHistory(title: string, history: readonly HistoryEntry[]): { exact?: Suggestion; similar: Suggestion[] } {
    const key = fold(title).trim()
    const latest = (entries: [HistoryEntry, number][]) => entries.reduce((a, b) => ((b[0].at ?? b[1]) >= (a[0].at ?? a[1]) ? b : a))
    const exact = history.map((h, i): [HistoryEntry, number] => [h, i]).filter(([h]) => fold(h.title).trim() === key)
    if (exact.length) {
      const [h] = latest(exact)
      return { exact: { id: h.categoryId, confidence: 1, why: [{ layer: 'history', text: title, match: h.title, weight: 1 }] }, similar: [] }
    }
    // Similar titles: share of this title's words that an earlier title also used.
    const mine = new Set(tokens(title))
    if (!mine.size) return { similar: [] }
    const best = new Map<string, Suggestion>()
    history.forEach((h) => {
      const theirs = tokens(h.title)
      let shared = 0
      for (const t of mine) shared += Math.max(0, ...theirs.map((o) => wordMatch(t, o)))
      const s = (HISTORY_SIMILAR_WEIGHT * shared) / Math.max(mine.size, theirs.length)
      const prev = best.get(h.categoryId)
      if (s > 0 && (!prev || s >= prev.confidence))
        best.set(h.categoryId, { id: h.categoryId, confidence: +s.toFixed(3), why: [{ layer: 'history', text: title, match: h.title, weight: s }] })
    })
    return { similar: [...best.values()].sort((a, b) => b.confidence - a.confidence) }
  }

  function rank(title: string, history: readonly HistoryEntry[] = []): Suggestion[] {
    const known = new Set(categories.map((c) => c.id))
    const h = scoreHistory(title, history.filter((e) => known.has(e.categoryId)))
    if (h.exact) return [h.exact]
    const data = scoreData(title)
    // Similar past titles only matter when the open data is unsure.
    if (h.similar.length && (!data.length || data[0].confidence < threshold) && h.similar[0].confidence >= threshold) {
      return [...h.similar, ...data.filter((d) => !h.similar.some((s) => s.id === d.id))]
    }
    return data
  }

  return {
    rank,
    suggest(title, history) {
      const top = rank(title, history)[0]
      return top && top.confidence >= threshold ? top : null
    },
  }
}

/** Returns a new history with this choice added. Persisting it is up to the app. */
export function learn(history: readonly HistoryEntry[], title: string, categoryId: string, at = Date.now()): HistoryEntry[] {
  return [...history, { title, categoryId, at }]
}
