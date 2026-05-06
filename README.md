# dev-harness

A toolkit of npm packages for Lightfast local development workflows: portless HTTPS aggregate, Vercel microfrontends config, dev-services container orchestration, and a thin CLI that ties them together.

## Packages

| Package | Description |
|---|---|
| [`@lightfastai/dev-cli`](packages/dev-cli) | CLI harness — `lightfast-dev` |
| [`@lightfastai/dev-core`](packages/dev-core) | Worktree, project-config, project-identity primitives |
| [`@lightfastai/dev-proxy`](packages/dev-proxy) | Portless + Vercel microfrontends helpers (`withPortlessProxy`, `getPortlessProxyOrigins`) |
| [`@lightfastai/dev-services`](packages/dev-services) | Postgres / Redis / Inngest dev container orchestration |

The four packages are version-locked via Changesets (see [`.changeset/config.json`](.changeset/config.json)) and consumed externally by the `lightfastai/lightfast` monorepo.

## Development

```bash
pnpm install
pnpm turbo build typecheck test --filter='@lightfastai/dev-*'
```

The `example/` workspace is a self-contained monorepo that exercises all four packages end-to-end.

## Releasing

1. Add a changeset describing the bump:

   ```bash
   pnpm changeset
   ```

2. Open a PR. With a changeset present, [`snapshot.yml`](.github/workflows/snapshot.yml) publishes a preview to npm under `pr-<number>` for downstream testing:

   ```bash
   pnpm add @lightfastai/dev-cli@pr-42
   ```

3. Merge the PR. The Changesets bot opens a "Version Packages" PR. Merging that PR triggers [`release.yml`](.github/workflows/release.yml) — packages publish to npm with provenance and a GitHub release is created.

## License

MIT — see [LICENSE](LICENSE).
