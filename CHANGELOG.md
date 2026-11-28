# Changelog

All notable changes to this project are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- A category's word no longer stands for a different word that starts the same way. A category described by
  "Train" was also taken to mean "trail" and "trailer", so "Gym membership" (a fitness trail) and "Hiking
  trail" suggested trains. The same applies to a title word matched against a category's word.
- A past title no longer matches a new title through two words the data knows as different words: after
  "Train to Leeds", "Hiking trail" is not suggested trains.
- Forms of a category's word that change the ending are recognised in more languages: Italian "pizze" for
  Pizza, Russian "машины" for Машина, French "chevaux" for Cheval.

### Changed

- Each words chunk has a new `endings` list: the ending pairs that join forms of one word in that locale
  ("~s", "ies~y", "a~e", and "~+ing" for a doubled letter as in "shopping"), learned from the locale's own
  words when the data is built. Two words that start the same count as forms of a category's word only when
  their endings are in that list. A locale that knows neither word has no say, and a locale with no list
  goes by the shape as before.
- The evaluation has a "word forms" set: 97 titles in 12 languages against categories described in the title's
  language, 36 of them lookalikes that should get no suggestion.

### Known limitations

- A lookalike whose ending is also a real ending in its language still matches ("booking" for Books), as can a
  title word the data doesn't know ("tablet" for Table). Rare and irregular forms are missed ("Züge" for Zug).
- A title word's own forms, and the words of a category's emoji, are still joined by the singular and plural
  shape only, so an emoji-only category does not gain the new forms.

## [0.1.2]

### Fixed

- A brand name that is also a word inside a longer title counts as both: "Flight to Delhi" now suggests
  flights, not only the travel agency named "Flight".
- A word's singular and plural count together: "Vegetables" also matches "vegetable", and "Groceries" also
  matches "grocery". Lookalikes don't count ("plane" and "plants", "chai" and "chair").
- Words found only inside a merged place variant's multi-word search terms are weak evidence: the teahouse's
  "yellow tea" made cafés (and so "Coffee" and "Chai") suggest a taxi.

## [0.1.1]

### Changed

- Published from GitHub Actions with npm provenance, so `npm audit signatures` can check where the package was built.

## [0.1.0]

### Added

- `createClassifier`: suggests one of the app's categories for a short title in any language, with a
  confidence and the reasons, or `null` when unsure.
- History learning: exact repeats win, most recent first; similar past titles count when the data is unsure.
- `createEmojiFinder`: emoji for free text, without categories.
- `loadData`: lazy per-locale and per-country data chunks, with locale fallback.
- Data for 161 locales and 257 regions from Unicode CLDR 49, the iD tagging schema and the
  OpenStreetMap name-suggestion-index.
