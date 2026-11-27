# Changelog

All notable changes to this project are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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
