# whatcategory

Suggest which of **your app's categories** fits a short title, in any language:
"Bus to Goa", "Abendessen", "Stromrechnung", "タクシー代", "Biedronka zakupy".

- **Offline.** No LLM, no network call, no API key. The title never leaves the device.
- **Your categories.** There are no built-in categories. Describe each one with an emoji, words in any language, or both.
- **Learns from history.** Pass past choices and repeats are recognised, including local shops and slang that no open data knows.
- **Small and lazy.** Load only the locales and countries you need. ESM, TypeScript types, zero runtime dependencies, browsers and Node 18+.
- **Explains itself.** Every suggestion says why.

It works for expense splitters, budgets, to-do lists, notes, inventories, bookmarks: anything that files short text into a few buckets.

```js
import { createClassifier, loadData, learn } from 'whatcategory'

const classifier = createClassifier({
  categories: [
    { id: 'food', emoji: '🍽️', words: ['Eating out'] },
    { id: 'groceries', emoji: '🛒', words: ['Groceries'] },
    { id: 'transport', emoji: '🚕', words: ['Transport'] },
    { id: 'bills', words: ['Bills', 'Rechnungen'] },
  ],
  // The user's languages in order of preference, and their country for brand names.
  data: await loadData({ locales: ['de', 'en'], regions: ['DE'] }),
})

classifier.suggest('Abendessen')
// → { id: 'food', confidence: 0.53, why: [{ layer: 'words', text: 'abendessen', match: '🍴', link: 'gabel', … }] }
classifier.suggest('Lidl')           // → groceries: brand → shop/supermarket, which shares "grocery"
classifier.suggest('Stromrechnung')  // → bills: "rechnung" inside the compound → 🧾
classifier.suggest('Sonstiges')      // → null: not sure, so no suggestion

// History is plain JSON. Store it however you like.
let history = learn([], 'Bäckerei Müller', 'food')
classifier.suggest('Bäckerei Müller', history) // → { id: 'food', confidence: 1, why: [{ layer: 'history', … }] }
```

## Install

```sh
npm install whatcategory
```

## Describing categories

```ts
interface Category {
  id: string        // yours, returned as-is
  emoji?: string    // the strongest signal: '🍺'
  words?: string[]  // in any language, the category's name works: ['Drinks', 'Getränke']
}
```

Give both when you can. An emoji is the strongest link, because emoji are annotated in every language. A name links
place types and brands: "Groceries" is what lets Lidl reach a 🛒 category. Words work in any loaded locale.
A category with only a vague name such as "Misc" or "Other" will rarely be suggested, and that's intended.

## Data

| Import | Contents | Size (gzip) |
|---|---|---|
| `whatcategory/words/<locale>` | Emoji names and keywords ([Unicode CLDR](https://cldr.unicode.org)) and place-type names and search terms ([iD tagging schema](https://github.com/openstreetmap/id-tagging-schema)), for 161 locales | ~90 KB each |
| `whatcategory/brands/<COUNTRY>` | Brand, operator and transit-network names from the [OSM name-suggestion-index](https://nsi.guide), with what kind of place each is. `001` is worldwide | 5–105 KB each |

`loadData({ locales, regions })` picks chunks for you. It falls back from `de-AT` to `de`, skips unknown locales and always adds the worldwide brands. Each chunk is a separate module behind a literal `import()`, so Vite, webpack, esbuild and Node load only what you ask for. You can also import chunks directly and pass them as `data`.

Load the user's language first. Adding `en` helps when categories are described in English, and English is the best-covered locale.

## API

### `createClassifier({ categories, data, threshold? })`

Returns `{ suggest(title, history?), rank(title, history?) }`.

- `suggest` returns the best `Suggestion`, or `null` when confidence is below `threshold` (default `0.08`).
- `rank` returns every category with any evidence, best first.
- `Suggestion` is `{ id, confidence, why }`. `confidence` is the lead over the runner-up, from 0 to 1. `why` lists the evidence: `layer` (`history`, `brand`, `words` or `category`), the `text` that matched, the emoji or place type it matched (`match`), and how that links to the category (`link`: `anchor` or the shared word).

Setup takes about 100 ms for two locales and a country, and each suggestion about 1 ms. Create one classifier and reuse it.

### History

`history` is an array of `{ title, categoryId, at? }` that you store. `learn(history, title, categoryId)` returns a new array.

- An exact repeat of a title wins, case- and accent-insensitively. The most recent wins, by `at` or else by array order.
- A past title that shares words ("Kamath Stores veggies" after "Kamath Stores") is used only when it is stronger evidence than the open data.
- Entries for category ids you no longer pass are ignored.

### `createEmojiFinder(data)`

`find(title, limit = 5)` returns `[{ emoji, score }]` with no categories needed: `find('Gitarre')` gives 🎸. It uses only the words chunks.

### Also exported

`loadData`, `resolveLocale`, `availableLocales`, `availableRegions`, `learn`, `tokens`, `fold`, and the types.

## How it works

```
title ─► history: exact repeat? ─────────────────────────────► past choice
  │
  ├─► split into words (Intl.Segmenter for ja/zh/th), lowercase, strip Latin/Greek/Cyrillic accents
  ├─► brand names (longest first)   "biedronka" ─► shop/supermarket
  ├─► other words ─► concepts       "zakupy" ─► 🛍 🛒 …   (exact, inflected, or inside a compound)
  │                  concept = an emoji or an OSM place type, described by its words in every locale
  ├─► concepts ─► your categories   anchor (the category's emoji, or a concept its words name) = 1,
  │                                 otherwise the most specific word they share
  └─► confidence = lead over the runner-up; below threshold ─► null
       (if a similar past title is stronger evidence, it wins)
```

There are no hand-written word lists. Everything general comes from the data:

- **Specificity.** A word that describes hundreds of concepts ("face", "store") counts for little.
- **Phrase fragments.** A word that is never a name or keyword on its own anywhere in its locale ("and", "la", "का") counts for little.
- **Locale preference.** When a word exists in several loaded locales, the first locale wins (French "courses" is not English "courses").
- **Brands.** Weight comes from how many NSI items of each place type carry the name, and sub-brands count ("Tesco Extra" counts for "Tesco").

## Accuracy

Measured on 541 hand-labelled titles in 19 languages (en, de, fr, es, it, pt, nl, pl, sv, ru, uk, el, tr, ar, hi, ja, zh, ko, th), including titles that should get no suggestion. Per-language numbers and every failure are in [eval/RESULTS.md](eval/RESULTS.md).

| Category set | Precision | Recall | No-suggestion correct | Best guess right (top-1) |
|---|---|---|---|---|
| Expenses: emoji + English name | 92% | 60% | 98% | 76% |
| Expenses: emoji only | 88% | 56% | 95% | 72% |
| To-do list | 85% | 36% | 83% | 58% |
| Home inventory: English words only | 81% | 36% | 60% | 66% |

**What this means:** when it suggests something, it is usually right. It stays silent on a third to a half of titles, and history fills those in for each user. Replaying one user's 26 expenses in order, history raised correct suggestions from 7 to 16.

The labels were written by the author, not by native speakers of all 19 languages. Corrections are welcome.

## Limitations

- **Concepts without an emoji or place type** are mostly missed: rent, subscriptions, insurance, salary.
- **App and online brands** (Uber, Airbnb, Netflix, Swiggy) are not in OpenStreetMap data. History learns them after one use.
- **Ambiguous brands** (Shell, Tesco, Amazon) spread across what they sell, so confidence is low.
- **Typos** are not corrected ("Resturant").
- **Loose inflection matching** can link unrelated words that share a start ("Flug" and "Flügel").
- **Closely related categories** such as Groceries and Shopping, or Transport and Fuel, share vocabulary and get confused. Distinct emoji help.
- Scoring constants were tuned on the evaluation set above. Expect somewhat lower numbers on other titles.

## Development

```sh
npm ci
npm run build:data   # generates data/ from the pinned upstream packages (~1 min)
npm test
npm run eval         # rewrites eval/RESULTS.md; commit it with any change that moves the numbers
node eval/explain.ts "Stromrechnung" --lang de --region DE   # see why a title scores the way it does
```

The data build needs Node 22.18+ (it runs TypeScript directly). The published library runs on Node 18+ and modern browsers.
Upstream data is pinned in `package-lock.json` and in `upstream/emoji-test.txt`, and rebuilds are byte-for-byte deterministic. A weekly workflow refreshes the data and opens a pull request showing how the results changed.

## Licence

Code: MIT. Bundled data: Unicode License v3 (CLDR, emoji-test), ISC (iD tagging schema) and BSD-3-Clause (name-suggestion-index). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
