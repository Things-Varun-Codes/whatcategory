// Shapes of the generated data chunks: plain, JSON-compatible objects.

/**
 * Words for one locale. Concepts are emoji (from CLDR) and OSM place types such as "shop/supermarket"
 * (from the iD tagging schema). Each concept is described by the words that annotate it.
 */
export interface WordsChunk {
  kind: 'words'
  locale: string
  /** Emoji without FE0F, or an OSM "key/value" path. */
  concepts: string[]
  /** token → packed entries: conceptIndex * 2 + (0 = part of the concept's name, 1 = keyword or search term). */
  index: Record<string, number[]>
}

/** Brand, operator and transit-network names for one country, from the OSM name-suggestion-index. */
export interface BrandsChunk {
  kind: 'brands'
  region: string
  /** OSM "key/value" paths the names are tagged with. */
  places: string[]
  /** nameKey(name) → packed entries: placeIndex * 4 + source (0 = brand, 1 = transit network, 2 = operator). */
  names: Record<string, number[]>
}

export type Chunk = WordsChunk | BrandsChunk
