// Smoke tests against the generated data (run `npm run build:data` first).
import { describe, expect, it } from 'vitest'
import { createClassifier, createEmojiFinder, loadData, resolveLocale, availableLocales } from '../src/index.ts'

const categories = [
  { id: 'food', emoji: '🍽️', words: ['Food'] },
  { id: 'groceries', emoji: '🛒', words: ['Groceries'] },
  { id: 'transport', emoji: '🚕', words: ['Transport'] },
  { id: 'health', emoji: '💊', words: ['Health'] },
]

describe('generated data', () => {
  it('resolves locales with fallback', () => {
    expect(availableLocales.length).toBeGreaterThan(100)
    expect(resolveLocale('de-AT')).toBe('de')
    expect(resolveLocale('pt_BR')).toBe('pt')
    expect(resolveLocale('zz')).toBeUndefined()
  })
  it('loads only known chunks and always the worldwide brands', async () => {
    const d = await loadData({ locales: ['de', 'zz', '../etc'], regions: ['de', '../x'] })
    expect(d.map((c) => (c.kind === 'words' ? c.locale : c.region))).toEqual(['de', '001', 'DE'])
  })
  it('classifies across languages and brands', async () => {
    const c = createClassifier({ categories, data: await loadData({ locales: ['de', 'ja', 'en'], regions: ['DE'] }) })
    expect(c.suggest('Abendessen')?.id).toBe('food')
    expect(c.suggest('Apotheke')?.id).toBe('health')
    expect(c.suggest('タクシー')?.id).toBe('transport')
    expect(c.suggest('Lidl')?.id).toBe('groceries')
    expect(c.suggest('Sonstiges')).toBeNull()
  })
  it('finds emoji for free text', async () => {
    const find = createEmojiFinder(await loadData({ locales: ['de', 'en'] }))
    expect(find('Gitarre')[0].emoji).toBe('🎸')
  })
})

describe('README example', () => {
  it('behaves as documented', async () => {
    const { learn } = await import('../src/index.ts')
    const classifier = createClassifier({
      categories: [
        { id: 'food', emoji: '🍽️', words: ['Eating out'] },
        { id: 'groceries', emoji: '🛒', words: ['Groceries'] },
        { id: 'transport', emoji: '🚕', words: ['Transport'] },
        { id: 'bills', words: ['Bills', 'Rechnungen'] },
      ],
      data: await loadData({ locales: ['de', 'en'], regions: ['DE'] }),
    })
    expect(classifier.suggest('Abendessen')).toMatchObject({ id: 'food', why: [{ layer: 'words', text: 'abendessen', match: '🍴' }] })
    expect(classifier.suggest('Lidl')?.id).toBe('groceries')
    expect(classifier.suggest('Stromrechnung')?.id).toBe('bills')
    expect(classifier.suggest('Sonstiges')).toBeNull()
    const history = learn([], 'Bäckerei Müller', 'food')
    expect(classifier.suggest('Bäckerei Müller', history)).toMatchObject({ id: 'food', confidence: 1 })
  })
})
