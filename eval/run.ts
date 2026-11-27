// Evaluation harness. Run: node eval/run.ts [--verbose] [--set expenses]
// Writes eval/results.json and eval/RESULTS.md so changes can be compared in review.
import { readFileSync, writeFileSync } from 'node:fs'
import { createClassifier, learn, type Category, type Chunk, type Classifier, type HistoryEntry } from '../src/index.ts'

const root = new URL('..', import.meta.url).pathname
const verbose = process.argv.includes('--verbose')
const THRESHOLD = process.argv.includes('--threshold') ? +process.argv[process.argv.indexOf('--threshold') + 1] : undefined
const only = process.argv.includes('--set') ? process.argv[process.argv.indexOf('--set') + 1] : null

/** The country whose brands an app in this language would load by default. */
const COUNTRY: Record<string, string> = {
  en: 'GB', de: 'DE', fr: 'FR', es: 'ES', it: 'IT', pt: 'PT', nl: 'NL', pl: 'PL', sv: 'SE', ru: 'RU', uk: 'UA',
  el: 'GR', tr: 'TR', ar: 'SA', hi: 'IN', ja: 'JP', zh: 'CN', ko: 'KR', th: 'TH',
}

type Case = [lang: string, title: string, expect: string | string[] | null, note?: string, country?: string]
interface Set { name: string; categories: Category[]; cases: Case[] }

const chunkCache = new Map<string, Chunk>()
async function chunk(path: string): Promise<Chunk> {
  if (!chunkCache.has(path)) chunkCache.set(path, (await import(`${root}data/${path}.js`)).default)
  return chunkCache.get(path)!
}
async function classifier(categories: Category[], locales: string[], regions: string[]): Promise<Classifier> {
  const data = await Promise.all([...new Set(locales)].map((l) => chunk(`words/${l}`)).concat(regions.map((r) => chunk(`brands/${r}`))))
  return createClassifier({ categories, data, threshold: THRESHOLD })
}

interface Tally { cases: number; expectSome: number; expectNull: number; suggested: number; correct: number; nullCorrect: number; top1: number }
const tally = (): Tally => ({ cases: 0, expectSome: 0, expectNull: 0, suggested: 0, correct: 0, nullCorrect: 0, top1: 0 })
const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : null)
const metrics = (t: Tally) => ({
  cases: t.cases,
  precision: pct(t.correct, t.suggested),
  recall: pct(t.correct, t.expectSome),
  nullCorrect: pct(t.nullCorrect, t.expectNull),
  top1: pct(t.top1, t.expectSome),
})

async function runSet(set: Set, label: string) {
  const byLang = new Map<string, Tally>()
  const all = tally()
  const failures: string[] = []
  const cache = new Map<string, Classifier>()
  for (const [lang, title, expect, note, country] of set.cases) {
    const region = country ?? COUNTRY[lang]
    const key = `${lang}|${region}`
    if (!cache.has(key)) cache.set(key, await classifier(set.categories, [lang, 'en'], [region]))
    const got = cache.get(key)!.suggest(title)
    const first = cache.get(key)!.rank(title)[0]
    const ok = expect === null ? got === null : got !== null && [expect].flat().includes(got.id)
    for (const t of [all, byLang.get(lang) ?? byLang.set(lang, tally()).get(lang)!]) {
      t.cases++
      if (expect === null) t.expectNull++
      else t.expectSome++
      if (got) t.suggested++
      if (ok && expect !== null) t.correct++
      if (ok && expect === null) t.nullCorrect++
      if (expect !== null && first && [expect].flat().includes(first.id)) t.top1++
    }
    if (!ok) {
      const why = got?.why.map((r) => `${r.layer}:${r.text}→${r.match}${r.link && r.link !== "anchor" ? `~${r.link}` : ""}(${r.weight})`).join(' ') ?? ''
      failures.push(`${lang} ${JSON.stringify(title)} want ${JSON.stringify(expect)} got ${got ? `${got.id} ${got.confidence}` : 'null'}${note ? ` [${note}]` : ''}${verbose ? '  ' + why : ''}`)
    }
  }
  return {
    label,
    overall: metrics(all),
    languages: Object.fromEntries([...byLang].sort().map(([l, t]) => [l, metrics(t)])),
    failures,
  }
}

async function runHistory() {
  const h = JSON.parse(readFileSync(root + 'eval/sets/history.json', 'utf8'))
  const set: Set = JSON.parse(readFileSync(root + `eval/sets/${h.set}.json`, 'utf8'))
  const c = await classifier(set.categories, h.locales, h.regions)
  let history: HistoryEntry[] = []
  let withH = 0
  let without = 0
  h.log.forEach(([title, id]: [string, string], i: number) => {
    if (c.suggest(title, history)?.id === id) withH++
    if (c.suggest(title)?.id === id) without++
    history = learn(history, title, id, i)
  })
  return { entries: h.log.length, correctWithHistory: withH, correctWithoutHistory: without }
}

const runs = []
for (const name of ['expenses', 'todo', 'inventory']) {
  if (only && only !== name) continue
  const set: Set = JSON.parse(readFileSync(root + `eval/sets/${name}.json`, 'utf8'))
  runs.push(await runSet(set, name))
  if (name === 'expenses') {
    // Same titles when the app gives emoji only, no words.
    runs.push(await runSet({ ...set, categories: set.categories.map(({ id, emoji }) => ({ id, emoji })) }, 'expenses (emoji only)'))
  }
}
const history = only ? null : await runHistory()

for (const r of runs) {
  console.log(`\n${r.label}: precision ${r.overall.precision}%  recall ${r.overall.recall}%  null-correct ${r.overall.nullCorrect}%  top-1 ${r.overall.top1}%  (${r.overall.cases} cases)`)
  if (verbose) for (const f of r.failures) console.log('  ✗ ' + f)
}
if (history) console.log(`\nhistory: ${history.correctWithHistory}/${history.entries} with history, ${history.correctWithoutHistory}/${history.entries} without`)

if (!only) {
  writeFileSync(root + 'eval/results.json', JSON.stringify({ runs, history }, null, 2) + '\n')
  const langs = [...new Set(runs.flatMap((r) => Object.keys(r.languages)))].sort()
  const cell = (m?: { precision: number | null; recall: number | null; nullCorrect: number | null }) =>
    m ? `${m.precision ?? '–'} / ${m.recall ?? '–'} / ${m.nullCorrect ?? '–'}` : ''
  let md = `# Evaluation results\n\nGenerated by \`npm run eval\`. Each cell is **precision / recall / null-correct**, in percent.\n\n`
  md += `- precision: suggestions that were right\n- recall: titles with a right answer that got it\n- null-correct: titles that should get no suggestion and got none\n\n`
  md += `| | ${runs.map((r) => r.label).join(' | ')} |\n|---|${runs.map(() => '---').join('|')}|\n`
  md += `| **all** | ${runs.map((r) => `**${cell(r.overall)}**`).join(' | ')} |\n`
  for (const l of langs) md += `| ${l} | ${runs.map((r) => cell(r.languages[l])).join(' | ')} |\n`
  if (history) md += `\n## History\n\nOne user's log of ${history.entries} expenses, predicted in order and then learned: **${history.correctWithHistory}** right with history, **${history.correctWithoutHistory}** without.\n`
  md += `\n## Failures\n\n`
  for (const r of runs) md += `### ${r.label}\n\n${r.failures.map((f) => `- ${f}`).join('\n') || 'None.'}\n\n`
  writeFileSync(root + 'eval/RESULTS.md', md)
}
