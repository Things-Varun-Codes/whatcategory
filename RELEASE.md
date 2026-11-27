# Releasing

Releases go to npm from GitHub Actions. Nobody publishes from a laptop, except the very first version.

## Every release

1. Move the **Unreleased** entries in `CHANGELOG.md` under a new version heading.
2. Bump the version: `npm version <patch|minor|major> --no-git-tag-version`, then commit both changes in a
   pull request titled `chore: release vX.Y.Z` and merge it.
3. On GitHub: **Releases → Draft a new release**, tag `vX.Y.Z` (it must match `package.json`), target
   `main`, paste the changelog section, **Publish release**.
4. The **Release** workflow runs CI and, if it passes, publishes to npm with provenance. Check with
   `npm view whatcategory version`. If CI fails, nothing is published: fix it, then delete the GitHub release
   (the tag stays) and publish a new patch version.

Data refreshes (the weekly pull request) are a patch release, unless the results got worse.

## How npm publishing is set up

The package's trusted publisher on npmjs.com is this repository's `release.yml`, environment `npm`, allowed
to run `npm publish` (and `npm stage publish`, which npm always allows). No npm token exists anywhere, and
**Publishing access** is set to require two-factor authentication and disallow tokens, so the release
workflow is the only way to publish. Publishing a GitHub release needs write access to this repository,
and only maintainers can create `v*` tags.

npm marks a new trusted publisher as pending until its first publish, and drops it if that doesn't happen
within a few days. If it lapses, add it again on the package's **Settings** page with the values above.
