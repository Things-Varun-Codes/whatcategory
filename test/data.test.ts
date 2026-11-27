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

describe('reported wrong suggestions', () => {
  // A typical expense app's categories, loaded for an Indian English user.
  const expenses = [
    { id: 'eating-out', emoji: '🍽️', words: ['Eating out'] },
    { id: 'groceries', emoji: '🛒', words: ['Groceries'] },
    { id: 'stays', emoji: '🛏️', words: ['Stays'] },
    { id: 'flights', emoji: '✈️', words: ['Flights'] },
    { id: 'taxis', emoji: '🚕', words: ['Taxis'] },
    { id: 'fuel', emoji: '⛽', words: ['Fuel'] },
    { id: 'medicine', emoji: '💊', words: ['Medicine'] },
    { id: 'shopping', emoji: '🛍️', words: ['Shopping'] },
  ]
  it('reads words and brands without false links', async () => {
    const c = createClassifier({ categories: expenses, data: await loadData({ locales: ['en'], regions: ['IN'] }) })
    // Cafés are not taxis: the teahouse's "yellow tea" no longer links them to 🚕 "yellow".
    expect(c.rank('Coffee')[0]?.id).not.toBe('taxis')
    expect(c.rank('Chai')[0]?.id).not.toBe('taxis')
    // ✈️ "plane" is not "plants"; "vegetables" also means "vegetable".
    expect(c.rank('Vegetables')[0]?.id).toBe('groceries')
    // "Flight" is a brand, but in a longer title it is also the word.
    expect(c.suggest('Flight to Delhi')?.id).toBe('flights')
    // Brands still count, alone and in a longer title.
    expect(c.suggest('Subway')?.id).toBe('eating-out')
    expect(c.suggest('Shell petrol')?.id).toBe('fuel')
    expect(c.suggest('Groceries')?.id).toBe('groceries')
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
