# Releasing

Releases go to npm from GitHub Actions. Nobody publishes from a laptop, except the very first version.

## Every release

1. Move the **Unreleased** entries in `CHANGELOG.md` under a new version heading.
2. Bump the version: `npm version <patch|minor|major> --no-git-tag-version`, then commit both changes in a
   pull request titled `chore: release vX.Y.Z` and merge it.
3. On GitHub: **Releases → Draft a new release**, tag `vX.Y.Z` (it must match `package.json`), target
   `main`, paste the changelog section, **Publish release**.
4. The **Release** workflow runs CI, then stages the version on npm with provenance. Nothing is live yet.
5. Approve it with two-factor authentication: on [npmjs.com](https://www.npmjs.com/package/whatcategory), or
   with `npm stage list whatcategory` and `npm stage approve <stage-id>` (npm 12 or newer). Check
   `npm view whatcategory version` afterwards.

Data refreshes (the weekly pull request) are a patch release, unless the results got worse.

## How npm publishing is set up

The package's trusted publisher on npmjs.com is this repository's `release.yml`, environment `npm`, with
the **npm stage publish** permission. That workflow can stage a version but not make it live; a maintainer's
two-factor approval does that. No npm token exists anywhere, and **Publishing access** is set to require
two-factor authentication and disallow tokens.

npm marks a new trusted publisher as pending until its first publish, and drops it if that doesn't happen
within a few days. If it lapses, add it again on the package's **Settings** page with the values above.
