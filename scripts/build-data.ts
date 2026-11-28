// Builds compact, deterministic data chunks from upstream open data:
//   data/words/<locale>.js   CLDR emoji names and keywords (Unicode-3.0) and
//                            iD tagging schema place names and search terms (ISC)
//   data/brands/<CC>.js      name-suggestion-index brands, operators and transit networks (BSD-3-Clause)
// Run: node scripts/build-data.ts
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tokens, nameKey, emojiKey, wordMatch, endingPair } from '../src/text.ts'
import type { WordsChunk, BrandsChunk } from '../src/data.ts'

const require = createRequire(import.meta.url)
const root = new URL('..', import.meta.url).pathname
for (const dep of ['cldr-annotations-full', 'cldr-core', 'name-suggestion-index', '@openstreetmap/id-tagging-schema']) {
  if (!existsSync(root + 'node_modules/' + dep)) {
    console.error(`The upstream data packages aren't installed (${dep} is missing). Run \`npm ci\` first.`)
    process.exit(1)
  }
}
const out = (p: string) => root + 'data/' + p

// ---- Unicode emoji list and subgroups. CLDR also annotates arrows, letters and symbols, which are not emoji. --
/** emoji → "#subgroup", a pseudo-word shared by emoji in the same Unicode subgroup (🚌 and 🚕: "#transport-ground"). */
const subgroupOf = new Map<string, string>()
/** emoji key → fully-qualified form with FE0F, so ✈ displays as ✈️. */
const qualified = new Map<string, string>()
{
  let group = ''
  let sub = ''
  for (const line of readFileSync(root + 'upstream/emoji-test.txt', 'utf8').split('\n')) {
    if (line.startsWith('# group: ')) group = line.slice(9).trim()
    else if (line.startsWith('# subgroup: ')) sub = line.slice(12).trim()
    else if (group !== 'Component' && /; (fully-qualified|unqualified|minimally-qualified)/.test(line)) {
      const e = emojiKey(line.split('#')[1].trim().split(' ')[0])
      if (!subgroupOf.has(e)) subgroupOf.set(e, '#' + sub)
      if (line.includes('; fully-qualified')) qualified.set(e, line.split('#')[1].trim().split(' ')[0])
    }
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
/** The OSM key/value a preset is about: "amenity/restaurant/indian" → "amenity/restaurant". Relation presets
 * put the real value third ("type/route/bus"), so they keep three parts. */
const placeType = (id: string) => id.split('/').slice(0, id.startsWith('type/') ? 3 : 2).join('/')
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
  // variant: words found only inside a merged variant's multi-word search terms ("yellow" from the teahouse's "yellow tea").
  const entries: [concept: string, name: string[], keywords: string[], group: string | null, variant?: Set<string>][] = []
  for (const char of Object.keys(ann).sort()) {
    const e = emojiKey(char)
    const q = qualified.get(e) ?? e
    if (subgroupOf.has(e) && !entries.some(([c]) => c === q)) entries.push([q, ann[char].tts ?? [], ann[char].default ?? [], subgroupOf.get(e)!])
  }
  // Variants such as amenity/restaurant/indian are merged into their place type, so a term repeated across
  // forty cuisines ("dinner") counts as describing one concept, not forty. Their names become its keywords.
  const merged = new Map<string, [string[], string[], string[]]>()
  for (const id of Object.keys(places).sort()) {
    if (!presets[id] || presets[id].searchable === false) continue
    const p = places[id]
    const base = placeType(id)
    const m = merged.get(base) ?? merged.set(base, [[], [], []]).get(base)!
    const names = [p.name ?? '', ...list(p.aliases)]
    if (base === id) m[0].push(...names), m[1].push(...list(p.terms))
    else m[1].push(...names), m[2].push(...list(p.terms))
  }
  const whole = (phrase: string) => tokens(phrase).length === 1 || !/\s/.test(phrase.trim())
  for (const [id, [name, keywords, variantTerms]] of merged) {
    const solid = new Set([...name, ...keywords, ...variantTerms.filter(whole)].flatMap(tokens))
    entries.push([id, name, [...keywords, ...variantTerms], null, new Set(variantTerms.flatMap(tokens).filter((w) => !solid.has(w)))])
  }
  // Words that are a whole name or keyword somewhere in this locale. The rest ("and", "la", "of") only ever
  // appear inside longer phrases. Scripts without spaces are segmented, so their pieces count as whole.
  const standalone = new Set<string>()
  for (const [, name, keywords] of entries) for (const phrase of [...name, ...keywords]) if (whole(phrase)) tokens(phrase).forEach((t) => standalone.add(t))
  const concepts: string[] = []
  const index: Record<string, number[]> = Object.create(null)
  for (const [concept, name, keywords, group, variant] of entries) {
    const nameTokens = new Set(name.flatMap(tokens))
    const all = new Set([...nameTokens, ...keywords.flatMap(tokens)])
    if (!all.size) continue
    const i = concepts.push(concept) - 1
    // Flags: 1 = keyword only, not in the name; 2 = a fragment: never a whole name or keyword anywhere in this locale,
    // or only inside a merged variant's multi-word search terms.
    for (const w of all) (index[w] ??= []).push(i * 4 + (nameTokens.has(w) ? 0 : 1) + (standalone.has(w) && !variant?.has(w) ? 0 : 2))
    if (group) (index[group] ??= []).push(i * 4 + 1)
  }
  const sorted: Record<string, number[]> = {}
  for (const k of Object.keys(index).sort()) sorted[k] = index[k]
  return { kind: 'words', locale, concepts, index: sorted, endings: learnEndings(sorted) }
}

/** An ending pair counts when at least this many word pairs with it describe a common concept... */
const ENDING_MIN_PAIRS = 3
/** ...and they are at least this share of all word pairs with it. English "l~n" (train/trail) is 0 of 3, "~s" 114 of 288. */
const ENDING_MIN_SHARE = 0.25

/**
 * The ending pairs that join forms of one word in a locale, learned from its own index: among all pairs of
 * words that start the same ("pizza"/"pizze", "train"/"trail"), the endings whose pairs often describe a common
 * concept. No language rules: Italian yields "a~e" and "i~o", English "~s" and "ies~y", Turkish "~lar".
 */
function learnEndings(index: Record<string, number[]>): string[] {
  const byStart = new Map<string, string[]>()
  for (const k of Object.keys(index)) if (k.length >= 4) (byStart.get(k.slice(0, 4)) ?? byStart.set(k.slice(0, 4), []).get(k.slice(0, 4))!).push(k)
  const seen = new Map<string, [shared: number, all: number]>()
  for (const group of byStart.values())
    for (let i = 0; i < group.length; i++)
      for (let j = i + 1; j < group.length; j++) {
        if (!wordMatch(group[i], group[j])) continue
        const pair = endingPair(group[i], group[j])
        const count = seen.get(pair) ?? seen.set(pair, [0, 0]).get(pair)!
        const concepts = new Set(index[group[i]].map((p) => p >> 2))
        if (index[group[j]].some((p) => concepts.has(p >> 2))) count[0]++
        count[1]++
      }
  return [...seen].filter(([, [shared, all]]) => shared >= ENDING_MIN_PAIRS && shared >= ENDING_MIN_SHARE * all).map(([pair]) => pair).sort()
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
  const id = [kv, 'type/' + kv].find((id) => presets[id] && presets[id].searchable !== false)
  return id ? placeType(id) : null
}
const SOURCE: Record<string, number> = { brands: 0, transit: 1, operators: 2 }
const tagPaths = Object.keys(nsi).filter((k) => k.split('/')[0] in SOURCE)

const NAME_FIELDS = /^(name|brand|operator|network|short_name|official_name)(:.+)?$/
// country → nameKey → place * 4 + source → how many NSI items with that name are of that place type, weighted.
// Tesco is mostly supermarkets and convenience stores, with a few fuel stations and pharmacies.
const perCountry = new Map<string, Map<string, Map<number, number>>>()
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
    // Sub-brands extend the parent's name ("Tesco Extra", "Tesco Express"), so they also count for "Tesco".
    const family = [...names].map((n) => nameKey(n.split(/\s+/)[0])).filter((k) => k.length >= 2 && !keys.includes(k))
    for (const c of locationCountries(item.locationSet.include)) {
      const m = perCountry.get(c) ?? perCountry.set(c, new Map()).get(c)!
      // An item named exactly so counts 2, a sub-brand 1.
      for (const [ks, n] of [[new Set(keys), 2], [new Set(family), 1]] as const)
        for (const k of ks) {
          const counts = m.get(k) ?? m.set(k, new Map()).get(k)!
          counts.set(packed, (counts.get(packed) ?? 0) + n)
        }
    }
  }
}

/** Brands for one region. Worldwide brands live in their own "001" chunk, which apps load alongside. */
function buildBrands(region: string): BrandsChunk {
  const places: string[] = []
  const local = new Map<number, number>()
  const names: Record<string, number[]> = {}
  const src = perCountry.get(region) ?? new Map()
  for (const k of [...src.keys()].sort()) {
    let entries = [...src.get(k)!].sort((a, b) => a[0] - b[0])
    // A name that is a brand doesn't need its operator entries ("Shell" also operates toilets and pipelines).
    if (entries.some(([p]) => (p & 3) === 0)) entries = entries.filter(([p]) => (p & 3) !== 2)
    names[k] = entries.flatMap(([p, n]) => {
      const g = p >> 2
      if (!local.has(g)) local.set(g, places.push(placeIds[g]) - 1)
      return [local.get(g)! * 4 + (p & 3), n]
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
for (const cc of ['001', ...countries]) {
  const c = buildBrands(cc)
  write(out(`brands/${cc}.js`), c)
  sizes.push([`brands/${cc}`, JSON.stringify(c).length])
}
// One loader per chunk with a literal path, so every bundler can split chunks and load them on demand.
const written = (dir: string) => readdirSync(out(dir)).map((f) => f.replace(/\.js$/, '')).sort()
const loaders = (dir: string) => `{\n${written(dir).map((n) => `  ${JSON.stringify(n)}: () => import('./${dir}/${n}.js'),`).join('\n')}\n}`
writeFileSync(
  out('index.js'),
  `// Generated by scripts/build-data.ts. Do not edit.\nexport const words = ${loaders('words')}\nexport const brands = ${loaders('brands')}\n`,
)
writeFileSync(
  out('index.d.ts'),
  `import type { WordsChunk, BrandsChunk } from '../dist/data.js'\n/** Loaders for each locale's words chunk. */\nexport declare const words: Record<string, () => Promise<{ default: WordsChunk }>>\n/** Loaders for each region's brands chunk ("001" is worldwide). */\nexport declare const brands: Record<string, () => Promise<{ default: BrandsChunk }>>\n`,
)
const kb = (n: number) => (n / 1024).toFixed(0) + ' KB'
sizes.sort((a, b) => b[1] - a[1])
console.log(`${sizes.length} chunks, ${kb(sizes.reduce((s, [, n]) => s + n, 0))} total. Largest:`)
for (const [n, s] of sizes.slice(0, 8)) console.log(`  ${n}  ${kb(s)}`)

// ---- licences of the bundled data ------------------------------------------------------------------
// Read from node_modules directly: some packages don't export their package.json.
const pkgDir = (name: string) => root + 'node_modules/' + name + '/'
const pkg = (name: string) => JSON.parse(readFileSync(pkgDir(name) + 'package.json', 'utf8'))
const licence = (name: string, file: string) => readFileSync(pkgDir(name) + file, 'utf8').trim()
const sources: [title: string, what: string, text: string][] = [
  [`Unicode CLDR annotations (cldr-annotations-full ${pkg('cldr-annotations-full').version}, cldr-core ${pkg('cldr-core').version})`,
    'Emoji names and keywords in data/words, and locale data used to build them.', licence('cldr-annotations-full', 'LICENSE')],
  [`Unicode emoji-test.txt (${readFileSync(root + 'upstream/emoji-test.txt', 'utf8').match(/# Version: (.+)/)?.[1]})`,
    'The list of emoji and their subgroups. Same licence as CLDR above.', '© Unicode, Inc. Unicode License v3, see above.'],
  [`iD tagging schema (@openstreetmap/id-tagging-schema ${pkg('@openstreetmap/id-tagging-schema').version})`,
    'Place type names and search terms in data/words.', licence('@openstreetmap/id-tagging-schema', 'LICENSE.md')],
  [`name-suggestion-index (${pkg('name-suggestion-index').version})`,
    'Brand, operator and network names in data/brands.', licence('name-suggestion-index', 'LICENSE.md')],
]
writeFileSync(
  root + 'THIRD_PARTY_NOTICES.md',
  `# Third-party notices\n\nThe code of whatcategory is MIT-licensed (see LICENSE). The generated data in \`data/\` is derived from the\nsources below and is distributed under their licences.\n\n` +
    sources.map(([t, w, l]) => `## ${t}\n\n${w}\n\n${l.replace(/^#+ /gm, '')}\n`).join('\n'),
)
