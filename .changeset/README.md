# Changesets

This repo uses [Changesets](https://github.com/changesets/changesets) to manage releases.

## Adding a changeset

```bash
pnpm changeset
```

Pick affected packages and a bump type (`patch` / `minor` / `major`). Write a one-line summary. Commit the generated `.changeset/*.md` file with your PR.

## Fixed group

`@lightfastai/dev-cli`, `@lightfastai/dev-core`, `@lightfastai/dev-proxy`, and `@lightfastai/dev-services` are version-locked. Selecting any of them in `pnpm changeset` bumps all four together — there is no way to ship a version drift between them.

## Snapshot publishes (PR previews)

When a PR contains a changeset, `snapshot.yml` publishes the four packages to npm under the `pr-<number>` dist-tag. Consumers can install the preview without waiting for merge:

```bash
pnpm add @lightfastai/dev-cli@pr-42
```

Snapshots never become `latest`.

## Releasing

1. Merge PRs that include changesets.
2. The Changesets bot opens a "Version Packages" PR aggregating all pending changesets.
3. Merging that PR triggers `release.yml` — packages publish to npm with provenance and a GitHub release is created.
