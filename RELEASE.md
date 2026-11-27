# Releasing

Releases go to npm from GitHub Actions. Nobody publishes from a laptop, except the very first version.

## Every release

1. Move the **Unreleased** entries in `CHANGELOG.md` under a new version heading.
2. Bump the version: `npm version <patch|minor|major> --no-git-tag-version`, then commit both changes in a
   pull request titled `chore: release vX.Y.Z` and merge it.
3. On GitHub: **Releases → Draft a new release**, tag `vX.Y.Z` (it must match `package.json`), target
   `main`, paste the changelog section, **Publish release**.
4. The **Release** workflow runs CI, then publishes to npm with provenance.

Data refreshes (the weekly pull request) are a patch release, unless the results got worse.

## One-time npm setup

npm trusted publishing lets the release workflow publish without any npm token being stored. npm only
offers it for a package that already exists, so the first version is published by hand.

1. On your computer, in this repository: `npm login`, then `npm publish --access public`.
   (`prepack` builds the data and the code first. It takes about a minute.)
2. On [npmjs.com](https://www.npmjs.com/package/whatcategory/access): **Settings → Trusted publisher →
   GitHub Actions**, and enter:
   - Organization or user: `Things-Varun-Codes`
   - Repository: `whatcategory`
   - Workflow filename: `release.yml`
   - Environment: `npm`
3. On the same page, under **Publishing access**, choose **Require two-factor authentication and disallow
   tokens**. From then on only the release workflow can publish.
