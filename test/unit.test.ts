import { describe, expect, it } from 'vitest'
import { createClassifier, createEmojiFinder, learn, tokens, type WordsChunk, type BrandsChunk } from '../src/index.ts'
import { nameKey, wordMatch } from '../src/text.ts'
import { isNumberForm } from '../src/words.ts'

// Tiny hand-made chunks so the scoring rules can be tested without the generated data.
const words: WordsChunk = {
  kind: 'words',
  locale: 'xx',
  concepts: ['🍺', '🍷', '🚕', '🚌', 'shop/supermarket', '🍽️'],
  // entry = conceptIndex * 4 + flags (1 = keyword only, 2 = never a whole phrase)
  index: {
    beer: [0], wine: [4], drink: [1, 5], taxi: [8], cab: [9], bus: [12], vehicle: [9, 13],
    supermarket: [16], grocery: [17], dinner: [21], constructor: [8], and: [3, 7, 11],
  },
}
const brandsChunk: BrandsChunk = { kind: 'brands', region: 'XX', places: ['shop/supermarket'], names: { megamart: [0, 2] } }
const categories = [
  { id: 'drinks', emoji: '🍺' },
  { id: 'transport', emoji: '🚕' },
  { id: 'groceries', words: ['grocery'] },
  { id: 'food', emoji: '🍽' },
]
const c = createClassifier({ categories, data: [words, brandsChunk] })

describe('text', () => {
  it('folds case, width and diacritics for Latin, Greek and Cyrillic only', () => {
    expect(tokens('Żabka ÉCOLE Пятёрочка Ταξί')).toEqual(['zabka', 'ecole', 'пятерочка', 'ταξι'])
    expect(nameKey('किराने का सामान')).toBe('किरानेकासामान') // Devanagari vowel signs are kept
  })
  it('splits scripts without spaces and elided articles', () => {
    expect(tokens('タクシー代')).toEqual(['タクシー', '代'])
    expect(tokens("l'aéroport")).toEqual(['l', 'aeroport'])
  })
  it('matches inflections but not unrelated prefixes', () => {
    expect(wordMatch('grocery', 'groceries')).toBeGreaterThan(0)
    expect(wordMatch('cervezas', 'cerveza')).toBeGreaterThan(0)
    expect(wordMatch('super', 'supermarket')).toBe(0)
    expect(wordMatch('bus', 'bush')).toBe(0)
  })
  it('tells singular and plural from lookalikes', () => {
    for (const [a, b] of [['vegetables', 'vegetable'], ['grocery', 'groceries'], ['cerveza', 'cervezas']]) expect(isNumberForm(a, b)).toBe(true)
    for (const [a, b] of [['plane', 'plants'], ['petrol', 'petri'], ['chai', 'chair'], ['hotell', 'hotellnatt']]) expect(isNumberForm(a, b)).toBe(false)
  })
})

describe('classifier', () => {
  it("suggests a category through the category's emoji", () => {
    expect(c.suggest('Beer')?.id).toBe('drinks')
    expect(c.suggest('Taxi')?.id).toBe('transport')
  })
  it('compares emoji without the FE0F variation selector', () => {
    expect(c.suggest('dinner')?.id).toBe('food')
  })
  it('links related concepts through shared words', () => {
    // 🚌 shares "vehicle" with 🚕, the transport anchor.
    expect(c.rank('bus')[0].id).toBe('transport')
  })
  it('links through category words and brands', () => {
    expect(c.suggest('supermarket')?.id).toBe('groceries')
    const s = c.suggest('Megamart')
    expect(s?.id).toBe('groceries')
    expect(s?.why[0]).toMatchObject({ layer: 'brand', text: 'megamart' })
  })
  it('returns null when nothing matches or the evidence is only filler', () => {
    expect(c.suggest('xyz123')).toBeNull()
    expect(c.suggest('')).toBeNull()
    expect(c.suggest('and')).toBeNull()
  })
  it('is not confused by words that are Object.prototype keys', () => {
    expect(() => c.rank('constructor toString __proto__')).not.toThrow()
  })
  it('explains suggestions', () => {
    expect(c.suggest('Beer')?.why[0]).toMatchObject({ layer: 'words', text: 'beer', match: '🍺', link: 'anchor' })
  })
})

describe('history', () => {
  it('lets an exact repeat win, most recent first, case-insensitively', () => {
    const h = learn(learn([], 'Kamath Stores', 'drinks', 1), 'kamath stores', 'groceries', 2)
    expect(c.suggest('Kamath Stores', h)).toMatchObject({ id: 'groceries', confidence: 1 })
  })
  it('uses `at` rather than array order when given', () => {
    const h = [
      { title: 'Corner', categoryId: 'groceries', at: 5 },
      { title: 'Corner', categoryId: 'drinks', at: 1 },
    ]
    expect(c.suggest('Corner', h)?.id).toBe('groceries')
  })
  it('overrides the data for exact repeats', () => {
    expect(c.suggest('Beer', [{ title: 'beer', categoryId: 'food' }])?.id).toBe('food')
  })
  it('uses similar titles only when the data is less sure', () => {
    const h = [{ title: 'Rapido', categoryId: 'transport' }]
    expect(c.suggest('Rapido ride', h)?.id).toBe('transport')
    expect(c.suggest('Beer Rapido', [{ title: 'Rapido', categoryId: 'food' }])?.id).toBe('drinks')
  })
  it('ignores history for categories the app no longer has', () => {
    expect(c.suggest('Beer', [{ title: 'Beer', categoryId: 'deleted' }])?.id).toBe('drinks')
  })
  it('learn() does not mutate and returns plain data', () => {
    const h: never[] = []
    const next = learn(h, 'Beer', 'drinks', 7)
    expect(h).toHaveLength(0)
    expect(JSON.parse(JSON.stringify(next))).toEqual([{ title: 'Beer', categoryId: 'drinks', at: 7 }])
  })
})

describe('emoji finder', () => {
  it('finds emoji without categories, in display form', () => {
    const find = createEmojiFinder([words])
    expect(find('dinner')[0].emoji).toBe('🍽️')
    expect(find('xyz')).toEqual([])
  })
})

describe('several locales', () => {
  it('prefers an exact match in any locale over a loose match in another', () => {
    const de: WordsChunk = { kind: 'words', locale: 'de', concepts: ['🐕'], index: { hund: [0] } }
    const en: WordsChunk = { kind: 'words', locale: 'en', concepts: ['💯'], index: { hundred: [0] } }
    expect(createEmojiFinder([de, en])('Hund').map((m) => m.emoji)).toEqual(['🐕'])
  })
  it('ignores filler words that are never a phrase on their own', () => {
    // "of" only appears inside 🚕's phrases (flag 2); as a word of its own it is weak evidence.
    const loc: WordsChunk = { kind: 'words', locale: 'xx', concepts: ['🍺', '🚕', '🍷'], index: { beer: [0], of: [6], taxi: [4], wine: [8] } }
    const k = createClassifier({ categories: [{ id: 'drinks', emoji: '🍺' }, { id: 'transport', emoji: '🚕' }], data: [loc] })
    expect(k.rank('of of beer')[0].id).toBe('drinks')
  })
})
