import type { Chunk, BrandsChunk } from './data.ts'
import { tokens, nameKey, emojiKey, wordMatch, fold } from './text.ts'
import { prepareLocale, tokenEvidence, inflections, entryWeight, isNumberForm, type Locale } from './words.ts'

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
  /** How that links to the category: "anchor" (the category's own emoji or a concept its words name), or the shared word. */
  link?: string
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

export const DEFAULT_THRESHOLD = 0.08
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
/** A link inferred from shared words counts at most this much; anchors count 1. */
const INFERRED_LINK = 0.7
/** Titles carrying less evidence than one specific word are scored as if they had this much, which keeps
 * a lone vague word from looking confident. */
const MIN_MASS = 0.5
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
  const display = new Map<string, string>()
  for (const loc of locales) loc.chunk.concepts.forEach((c, i) => display.set(loc.concepts[i], c))

  // Every word a category is described by, 0..1: its own words fully, and the words of its anchor concepts
  // (its emoji, and concepts its words name or describe) as strongly as the anchor. A vague word
  // such as "out" in "Eating out" names hundreds of concepts, so it anchors each of them only weakly.
  const categories = options.categories.map((cat) => {
    const words = (cat.words ?? []).flatMap(tokens)
    const anchors = new Map<string, number>()
    const anchor = (c: string, s: number) => anchors.set(c, Math.max(anchors.get(c) ?? 0, s))
    if (cat.emoji) anchor(emojiKey(cat.emoji), 1)
    for (const w of words)
      for (const loc of locales)
        for (const [k, q] of [[w, 1] as [string, number], ...inflections(w, loc)])
          for (const p of Object.hasOwn(loc.chunk.index, k) ? loc.chunk.index[k] : [])
            anchor(loc.concepts[p >> 2], q * loc.spec.get(k)! * entryWeight(p))
    const described = new Map<string, number>()
    const put = (w: string, s: number) => described.set(w, Math.max(described.get(w) ?? 0, s))
    for (const w of words) put(w, 1)
    for (const [c, s] of anchors) for (const loc of locales) for (const [w, bw] of loc.bags.get(c) ?? []) put(w, s * bw)
    // Inflected forms count too ("grocery" describes a category called "Groceries"). For the words of its anchors,
    // only singular and plural: a shared start would link ✈️ "plane" to "plants".
    const own = new Set(words)
    for (const [w, s] of [...described])
      for (const loc of locales) for (const [k, q] of inflections(w, loc)) if (own.has(w) || isNumberForm(w, k)) put(k, s * q)
    return { id: cat.id, words, anchors, described }
  })

  interface Link { strength: number; via: string }
  const simCache = new Map<string, Link[]>()
  /**
   * How strongly each category covers a concept: 1 for an anchor, otherwise the most specific word they share,
   * scaled down so that a category's own emoji and words always beat a link inferred from shared words.
   * Sharing "movie" links 🎦 and 🎬; sharing "store" barely counts.
   */
  function conceptLinks(concept: string): Link[] {
    let links = simCache.get(concept)
    if (links) return links
    const words = new Map<string, number>()
    for (const loc of locales) for (const [w, bw] of loc.bags.get(concept) ?? []) words.set(w, Math.max(words.get(w) ?? 0, loc.spec.get(w)! * bw))
    links = categories.map((cat): Link => {
      let best: Link = { strength: cat.anchors.get(concept) ?? 0, via: 'anchor' }
      for (const [w, spec] of words) {
        const s = INFERRED_LINK * spec * (cat.described.get(w) ?? 0)
        if (s > best.strength) best = { strength: s, via: w }
      }
      return best
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
      const e = b.names[key]
      for (let i = 0; i < e.length; i += 2) {
        const place = b.places[e[i] >> 2]
        hits.set(place, (hits.get(place) ?? 0) + SOURCE_TRUST[e[i] & 3] * e[i + 1])
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
        // A brand that is also a word inside a longer title ("Flight to Delhi", "Hotel in Goa") counts as the word too.
        if (n > 1 || toks.length === 1 || !isWord(nameKey(toks[i]))) {
          i += n
          continue
        }
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
        mass: weight * Math.max(ev ? ev.quality * ev.spec : 0, ...direct.values()),
        reason: direct.size ? { layer: 'category', text: t, match: [...direct.keys()][0] } : { layer: 'words', text: t, match: top! },
      })
    }
    return out
  }

  function scoreData(title: string): Suggestion[] {
    const evs = evidence(title)
    const mass = evs.reduce((s, e) => s + e.mass, 0)
    if (!mass) return []
    const totalMass = Math.max(mass, MIN_MASS)
    const scores = categories.map(() => 0)
    const why: Reason[][] = categories.map(() => [])
    for (const ev of evs) {
      const contrib = categories.map(() => ({ score: 0, top: 0, concept: '', via: '' }))
      for (const [concept, share] of ev.hits)
        conceptLinks(concept).forEach((l, ci) => {
          const c = contrib[ci]
          c.score += share * l.strength
          if (share * l.strength > c.top) Object.assign(c, { top: share * l.strength, concept, via: l.via })
        })
      categories.forEach((cat, ci) => {
        const c = contrib[ci]
        const direct = ev.direct.get(cat.id) ?? 0
        const value = Math.max(c.score, direct)
        if (value <= 0) return
        scores[ci] += ev.mass * value
        const reason: Reason =
          direct >= c.score
            ? { layer: 'category', text: ev.reason.text, match: ev.reason.text, link: 'anchor', weight: 0 }
            : { ...ev.reason, match: display.get(c.concept) ?? c.concept, link: c.via, weight: 0 }
        why[ci].push({ ...reason, weight: +(ev.mass * value).toFixed(3) })
      })
    }
    // Confidence is the lead over the runner-up: diffuse evidence that fits several categories is not a suggestion.
    const raw = scores.map((x) => x / totalMass)
    const [first = 0, second = 0] = [...raw].sort((a, b) => b - a)
    const lead = (x: number) => (x === first ? x - second : x - first)
    return categories
      .map((cat, ci) => ({
        id: cat.id,
        confidence: +Math.max(0, lead(raw[ci])).toFixed(3),
        // Reasons that carry under 5% of the score are noise in an explanation.
        why: why[ci].filter((r) => r.weight >= 0.05 * scores[ci]).sort((a, b) => b.weight - a.weight),
        score: raw[ci],
      }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ score, ...s }) => s)
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
    // Similar past titles only matter when the open data is less sure than they are.
    if (h.similar.length && h.similar[0].confidence > (data[0]?.confidence ?? 0)) {
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

export interface EmojiMatch {
  emoji: string
  /** 0..1, share of the title's evidence. */
  score: number
}

/**
 * Emoji that match a title, best first, without any categories: "Gitarre" → 🎸. Uses the CLDR words in the
 * given word chunks. Brands are not used here; they link to place types, not emoji.
 */
export function createEmojiFinder(data: Chunk[]): (title: string, limit?: number) => EmojiMatch[] {
  const locales = data.filter((c) => c.kind === 'words').map(prepareLocale)
  const display = new Map<string, string>()
  for (const loc of locales) loc.chunk.concepts.forEach((c, i) => display.set(loc.concepts[i], c))
  return (title, limit = 5) => {
    const scores = new Map<string, number>()
    let total = 0
    tokens(title).forEach((t, i) => {
      const ev = tokenEvidence(t, locales)
      if (!ev) return
      const mass = (ev.quality * ev.spec) / (1 + POSITION_DECAY * i)
      total += mass
      for (const [c, share] of ev.hits) if (!c.includes('/')) scores.set(c, (scores.get(c) ?? 0) + mass * share)
    })
    return [...scores]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([c, s]) => ({ emoji: display.get(c) ?? c, score: +(s / Math.max(total, MIN_MASS)).toFixed(3) }))
  }
}

/** Returns a new history with this choice added. Persisting it is up to the app. */
export function learn(history: readonly HistoryEntry[], title: string, categoryId: string, at = Date.now()): HistoryEntry[] {
  return [...history, { title, categoryId, at }]
}

export { loadData, resolveLocale, availableLocales, availableRegions, type LoadOptions } from './load.ts'
