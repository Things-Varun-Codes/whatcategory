// Show how a title is scored. Run: node eval/explain.ts "Abendessen" [--lang de] [--region DE] [--set expenses]
import { readFileSync } from 'node:fs'
import { createClassifier } from '../src/index.ts'

const arg = (name: string, fallback: string) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback)
const root = new URL('..', import.meta.url).pathname
const lang = arg('--lang', 'en')
const set = JSON.parse(readFileSync(`${root}eval/sets/${arg('--set', 'expenses')}.json`, 'utf8'))
const load = async (p: string) => (await import(`${root}data/${p}.js`)).default
const data = await Promise.all([...new Set([lang, 'en'])].map((l) => load(`words/${l}`)).concat(load('brands/001'), load(`brands/${arg('--region', 'GB')}`)))
const c = createClassifier({ categories: Array.isArray(set.categories) ? set.categories : set.categories[lang], data })
for (const s of c.rank(process.argv[2]).slice(0, 4)) {
  console.log(`${s.id} ${s.confidence}`)
  for (const r of s.why) console.log(`   ${r.layer} "${r.text}" → ${r.match}${r.link && r.link !== 'anchor' ? ` (shares "${r.link}")` : ''}  ${r.weight}`)
}
