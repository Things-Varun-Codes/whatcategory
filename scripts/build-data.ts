// Builds compact, deterministic data chunks from upstream open data:
//   data/words/<locale>.js   CLDR emoji names and keywords (Unicode-3.0) and
//                            iD tagging schema place names and search terms (ISC)
//   data/brands/<CC>.js      name-suggestion-index brands, operators and transit networks (BSD-3-Clause)
// Run: node scripts/build-data.ts
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tokens, nameKey, emojiKey } from '../src/text.ts'
import type { WordsChunk, BrandsChunk } from '../src/data.ts'

const require = createRequire(import.meta.url)
const root = new URL('..', import.meta.url).pathname
const out = (p: string) => root + 'data/' + p

// ---- Unicode emoji list: CLDR also annotates arrows, letters and symbols, which are not emoji ------------
const isEmoji = new Set<string>()
{
  let group = ''
  for (const line of readFileSync(root + 'upstream/emoji-test.txt', 'utf8').split('\n')) {
    if (line.startsWith('# group: ')) group = line.slice(9).trim()
    else if (group !== 'Component' && /; (fully-qualified|unqualified|minimally-qualified)/.test(line))
      isEmoji.add(emojiKey(line.split('#')[1].trim().split(' ')[0]))
  }
}

// ---- CLDR words ---------------------------------------------------------------
type Ann = Record<string, { default?: string[]; tts?: string[] }>
const cldrDir = require.resolve('cldr-annotations-full/package.json').replace(/package\.json$/, 'annotations/')
const parents: Record<string, string> = require('cldr-core/supplemental/parentLocales.json').supplemental.parentLocales.parentLocale
const available = new Set(readdirSync(cldrDir))
const rawCache = new Map<string, Ann>()
const raw = (l: string): Ann => {
  if (!rawCache.has(l)) rawCache.set(l, require(`${cldrDir}${l}/annotations.json`).annotations.annotations ?? {})
  return rawCache.get(l)!
}
function parentOf(l: string): string | null {
  if (parents[l]) return parents[l] === 'root' ? null : parents[l]
  const i = l.lastIndexOf('-')
  return i > 0 ? l.slice(0, i) : null
}
/** Sub-locales such as en-GB only list differences, so overlay them on their parents. */
function resolved(l: string): Ann {
  const p = parentOf(l)
  const base = p && available.has(p) ? resolved(p) : {}
  const merged: Ann = { ...base }
  for (const [e, a] of Object.entries(raw(l))) merged[e] = { ...base[e], ...a }
  return merged
}

// ---- iD tagging schema places ------------------------------------------------------
const idDir = require.resolve('@openstreetmap/id-tagging-schema/package.json').replace(/package\.json$/, 'dist/')
const presets: Record<string, { searchable?: boolean }> = require(idDir + 'presets.json')
const idLocales = new Set(readdirSync(idDir + 'translations').map((f) => f.replace(/\.json$/, '')))
const likely: Record<string, string> = require('cldr-core/supplemental/likelySubtags.json').supplemental.likelySubtags
type Preset = { name?: string; aliases?: string | string[]; terms?: string | string[] }
const list = (v?: string | string[]) => (Array.isArray(v) ? v : (v ?? '').split(',')).filter(Boolean)

/** iD translation file for a CLDR locale: exact, then the likely region (pt → pt-BR, zh-Hant → zh-TW), then the language. */
function idPresets(locale: string): Record<string, Preset> {
  const lang = locale.split('-')[0]
  const region = (likely[locale] ?? likely[lang] ?? '').split('-').pop()
  const file = [locale, `${lang}-${region}`, lang].find((l) => idLocales.has(l))
  if (!file) return {}
  return require(`${idDir}translations/${file}.json`)[file]?.presets?.presets ?? {}
}

function buildWords(locale: string): WordsChunk {
  const ann = resolved(locale)
  const places = idPresets(locale)
  const entries: [string, string[], string[]][] = []
  for (const char of Object.keys(ann).sort()) {
    const e = emojiKey(char)
    if (isEmoji.has(e) && !entries.some(([c]) => c === e)) entries.push([e, ann[char].tts ?? [], ann[char].default ?? []])
  }
  for (const id of Object.keys(places).sort()) {
    if (!presets[id] || presets[id].searchable === false) continue
    const p = places[id]
    entries.push([id, [p.name ?? '', ...list(p.aliases)], list(p.terms)])
  }
  // Words that are a whole name or keyword somewhere in this locale. The rest ("and", "la", "of") only ever
  // appear inside longer phrases. Scripts without spaces are segmented, so their pieces count as whole.
  const standalone = new Set<string>()
  for (const [, name, keywords] of entries)
    for (const phrase of [...name, ...keywords]) {
      const toks = tokens(phrase)
      if (toks.length === 1 || !/\s/.test(phrase.trim())) toks.forEach((t) => standalone.add(t))
    }
  const concepts: string[] = []
  const index: Record<string, number[]> = Object.create(null)
  for (const [concept, name, keywords] of entries) {
    const nameTokens = new Set(name.flatMap(tokens))
    const all = new Set([...nameTokens, ...keywords.flatMap(tokens)])
    if (!all.size) continue
    const i = concepts.push(concept) - 1
    // Flags: 1 = keyword only, not in the name; 2 = never a whole name or keyword anywhere in this locale.
    for (const w of all) (index[w] ??= []).push(i * 4 + (nameTokens.has(w) ? 0 : 1) + (standalone.has(w) ? 0 : 2))
  }
  const sorted: Record<string, number[]> = {}
  for (const k of Object.keys(index).sort()) sorted[k] = index[k]
  return { kind: 'words', locale, concepts, index: sorted }
}

// ---- NSI brands -----------------------------------------------------------------
const nsi = require('name-suggestion-index/dist/json/nsi.json').nsi as Record<
  string,
  { items: { displayName: string; locationSet: { include?: unknown[] }; matchNames?: string[]; tags: Record<string, string> }[] }
>
const containment = require('cldr-core/supplemental/territoryContainment.json').supplemental.territoryContainment as Record<
  string,
  { _contains?: string[] }
>
function expandRegion(code: string): string[] {
  const c = containment[code]?._contains
  return c ? c.flatMap(expandRegion) : [code]
}
const countries = [...new Set(expandRegion('001'))].filter((c) => /^[A-Z]{2}$/.test(c)).sort()

/** NSI locations → ISO country codes, or '001' for worldwide. Custom polygons are mapped to their country prefix. */
function locationCountries(include: unknown[] = []): string[] {
  const outSet = new Set<string>()
  for (const l of include) {
    if (typeof l !== 'string') continue
    const id = l.toLowerCase().replace(/\.geojson$/, '')
    if (id === '001') outSet.add('001')
    else if (/^\d{3}$/.test(id)) for (const c of expandRegion(id)) outSet.add(c)
    else if (/^[a-z]{2}([-_]|$)/.test(id)) outSet.add(id.slice(0, 2).toUpperCase())
  }
  return [...outSet]
}

/** NSI path "brands/shop/supermarket" → iD preset id "shop/supermarket" (transit routes live under "type/"). */
function placeOf(path: string): string | null {
  const kv = path.split('/').slice(1).join('/')
  return [kv, 'type/' + kv].find((id) => presets[id] && presets[id].searchable !== false) ?? null
}
const SOURCE: Record<string, number> = { brands: 0, transit: 1, operators: 2 }
const tagPaths = Object.keys(nsi).filter((k) => k.split('/')[0] in SOURCE)

const NAME_FIELDS = /^(name|brand|operator|network|short_name|official_name)(:.+)?$/
const perCountry = new Map<string, Map<string, Set<number>>>() // country → nameKey → place * 4 + source
const placeIds: string[] = []
for (const path of tagPaths.sort()) {
  const place = placeOf(path)
  if (place === null) continue
  let pi = placeIds.indexOf(place)
  if (pi < 0) pi = placeIds.push(place) - 1
  const packed = pi * 4 + SOURCE[path.split('/')[0]]
  for (const item of nsi[path].items) {
    const names = new Set<string>([item.displayName, ...(item.matchNames ?? [])])
    for (const [k, v] of Object.entries(item.tags)) if (NAME_FIELDS.test(k)) names.add(v)
    const keys = [...names].map(nameKey).filter((k) => k.length >= 2)
    for (const c of locationCountries(item.locationSet.include)) {
      const m = perCountry.get(c) ?? perCountry.set(c, new Map()).get(c)!
      for (const k of keys) (m.get(k) ?? m.set(k, new Set()).get(k)!).add(packed)
    }
  }
}

function buildBrands(region: string): BrandsChunk {
  const merged = new Map<string, Set<number>>()
  for (const src of [perCountry.get('001'), perCountry.get(region)])
    for (const [k, packed] of src ?? []) for (const p of packed) (merged.get(k) ?? merged.set(k, new Set()).get(k)!).add(p)
  const places: string[] = []
  const local = new Map<number, number>()
  const names: Record<string, number[]> = {}
  for (const k of [...merged.keys()].sort()) {
    names[k] = [...merged.get(k)!].sort((a, b) => a - b).map((p) => {
      const g = p >> 2
      if (!local.has(g)) local.set(g, places.push(placeIds[g]) - 1)
      return local.get(g)! * 4 + (p & 3)
    })
  }
  return { kind: 'brands', region, places, names }
}

// ---- write ------------------------------------------------------------------------
const write = (path: string, data: unknown) =>
  writeFileSync(path, `// Generated by scripts/build-data.ts. Do not edit.\nexport default ${JSON.stringify(data)}\n`)

rmSync(out(''), { recursive: true, force: true })
mkdirSync(out('words'), { recursive: true })
mkdirSync(out('brands'), { recursive: true })
const sizes: [string, number][] = []
for (const l of [...available].sort()) {
  const c = buildWords(l)
  if (!c.concepts.length) continue
  write(out(`words/${l}.js`), c)
  sizes.push([`words/${l}`, JSON.stringify(c).length])
}
for (const cc of countries) {
  const c = buildBrands(cc)
  write(out(`brands/${cc}.js`), c)
  sizes.push([`brands/${cc}`, JSON.stringify(c).length])
}
const kb = (n: number) => (n / 1024).toFixed(0) + ' KB'
sizes.sort((a, b) => b[1] - a[1])
console.log(`${sizes.length} chunks, ${kb(sizes.reduce((s, [, n]) => s + n, 0))} total. Largest:`)
for (const [n, s] of sizes.slice(0, 8)) console.log(`  ${n}  ${kb(s)}`)
