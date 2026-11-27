// Lazy loading of data chunks. Each chunk is its own module behind a literal import(), so bundlers split them
// and apps only download the locales and regions they ask for.
import type { Chunk } from './data.ts'
import { words, brands } from '../data/index.js'

/** Locales with a words chunk. */
export const availableLocales: readonly string[] = Object.keys(words)
/** Regions with a brands chunk ("001" is worldwide). */
export const availableRegions: readonly string[] = Object.keys(brands)

/** The closest available locale: "de-AT" → "de-AT" if present, else "de". Undefined if none. */
export function resolveLocale(locale: string): string | undefined {
  const parts = locale.replace(/_/g, '-').split('-')
  for (let n = parts.length; n > 0; n--) {
    const want = parts.slice(0, n).join('-').toLowerCase()
    const hit = availableLocales.find((l) => l.toLowerCase() === want)
    if (hit) return hit
  }
  return undefined
}

export interface LoadOptions {
  /** BCP 47 locales in order of preference, e.g. navigator.languages. Unknown ones are skipped. */
  locales?: readonly string[]
  /** ISO 3166 country codes for brand names, e.g. ["DE"]. Worldwide brands are always included. */
  regions?: readonly string[]
}

/** Loads the word chunks for `locales` and brand chunks for `regions`, ready for createClassifier. */
export async function loadData({ locales = [], regions = [] }: LoadOptions): Promise<Chunk[]> {
  const ls = [...new Set(locales.map(resolveLocale).filter((l): l is string => !!l))]
  const rs = [...new Set(['001', ...regions.map((r) => r.toUpperCase())])].filter((r) => Object.hasOwn(brands, r))
  return Promise.all([...ls.map(async (l) => (await words[l]()).default), ...rs.map(async (r) => (await brands[r]()).default)])
}
