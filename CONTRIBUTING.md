# Contributing to whatcategory

Thanks for helping. This covers getting set up, the rules the code follows, and the checks your change
has to pass. Everyone taking part is expected to follow the [code of conduct](./CODE_OF_CONDUCT.md).

For anything bigger than a bug fix, open an issue or a discussion before writing the code, so nobody
builds something that can't be merged.

## The rules that matter most

1. **No hand-written word lists.** No lists of words, brands, stop words or per-language rules, anywhere.
   Everything general comes from the open upstream data and from language-agnostic algorithms. Tuning
   constants (weights, thresholds) are fine. If a quality problem tempts you toward a list, solve it with
   a general rule or with data, or record it as a known limitation in the README.
2. **Generic.** No assumptions about money, expenses or any other domain. Apps bring their own categories.
3. **Offline and small.** No network calls and no runtime dependencies. Data stays split into per-locale
   and per-country chunks.

## Getting set up

You need Node 22.18 or newer (`.nvmrc` says 22; the data build runs TypeScript directly).

```sh
npm ci
npm run build:data   # generates data/ from the pinned upstream packages (~1 min)
npm test
```

## Measuring a change

Accuracy is measured, not argued about. `eval/sets/` holds hand-labelled titles in 19 languages,
including titles that should get no suggestion.

```sh
npm run eval                                                  # rewrites eval/RESULTS.md and eval/results.json
node eval/run.ts --verbose --set expenses                     # every failure, with its reasons
node eval/explain.ts "Stromrechnung" --lang de --region DE   # why one title scores the way it does
```

Commit `eval/RESULTS.md` and `eval/results.json` with any change that moves the numbers. CI fails if they
don't match the code. Say in the pull request what got better and what got worse. A change that fixes a
few titles by breaking others isn't an improvement.

Adding cases to `eval/sets/` is very welcome, especially from native speakers. A case is
`[locale, title, expected category id or null, note?, country?]`.

Results depend slightly on the ICU version in Node, which splits Japanese, Chinese and Thai into words.
CI uses the Node version in `.nvmrc`. If your numbers differ only in those languages, check your Node version.

## Tests and CI

| Command | What it proves |
|---|---|
| `npm test` | Scoring rules on small hand-made chunks, plus smoke tests and the README example on the generated data |
| `npm run eval` | Precision, recall and null-correctness per language |
| `npm run typecheck` | Types |

On every pull request, GitHub Actions builds the data, runs the tests and the evaluation, checks that the
results are committed, and checks the library on Node 18. CodeQL scans the code. A pull request that adds
a dependency with a known vulnerability, or under a GPL or AGPL licence, fails the dependency review.

`main` only takes pull requests, squash-merged once those checks pass. Workflows from a first-time
contributor wait for a maintainer to start them.

## Pull requests

- Keep each one to one change, and explain why, not just what.
- The title follows [Conventional Commits](https://www.conventionalcommits.org) (`fix: …`, `feat: …`).
  It becomes the commit on `main`.
- Add a test that fails without your change.
- If someone using the library would notice the change, add a line under **Unreleased** in
  [`CHANGELOG.md`](./CHANGELOG.md).
- Third-party GitHub Actions are pinned to a full commit SHA, with the version in a comment.
- Comments explain why the code is the way it is. No ticket or planning references.
- No real names, emails or addresses in fixtures, docs or commits.

## How the code is organised

| Path | What |
|---|---|
| `src/text.ts` | Normalising and splitting text, inflection matching |
| `src/words.ts` | Word → concept evidence, specificity |
| `src/index.ts` | The classifier, history, the emoji finder |
| `src/load.ts` | Picking and lazily loading data chunks |
| `scripts/build-data.ts` | Builds `data/` from CLDR, the iD tagging schema and the name-suggestion-index |
| `eval/` | The evaluation sets and tools |

## Reporting bugs

Use the issue forms: **Wrong or missing suggestion** for a title that scored badly, and **Bug report** for
anything else. Security problems go through [`SECURITY.md`](./SECURITY.md) instead.
