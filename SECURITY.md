# Security

## Reporting a vulnerability

Please report it privately through GitHub, with
[this form](https://github.com/Things-Varun-Codes/whatcategory/security/advisories/new) (it's also under
the repository's **Security** tab, **Report a vulnerability**). Don't open a public issue.

Include what you found, how to reproduce it and what an attacker could do with it. This is a spare-time
project, so a reply can take a few days. Once there's a fix, you'll be credited if you'd like to be.

Fixes go into the latest release; older versions don't get them. A fix that matters to people using the
library is published as a security advisory on this repository, with the version to upgrade to.

## Checking a release

Releases are published to npm only by this repository's release workflow, with npm provenance. To check
that the package you installed was built from this repository:

```sh
npm audit signatures
```

## What whatcategory is designed for

It runs inside your app, on text your app gives it.

### What it protects

- **The text.** Titles and history never leave the process. The library makes no network requests, and
  data chunks are bundled modules loaded with `import()`, never fetched from elsewhere.
- **Loading.** `loadData` only imports chunks named in the generated list of loaders, so locale and region
  strings from users can't point it at other files.
- **Odd input.** Titles are treated as data. Words such as `constructor` or `__proto__` are looked up safely.
- **The supply chain.** No runtime dependencies. Upstream data packages are pinned in `package-lock.json`,
  rebuilt deterministically, and updated only through a reviewed pull request that shows how the results
  changed.

### What it doesn't

- **What the history says.** History is the app's own data. Whatever the app passes in can steer the
  suggestions, so don't merge history from people you don't trust.
- **Very long input.** Work grows with the length of the title. Limit titles to a sensible length in your
  app if users can submit arbitrary text.
- **The upstream data.** The data comes from community projects (Unicode CLDR, OpenStreetMap). A
  suggestion is a hint for a person to accept or change, not a decision.
