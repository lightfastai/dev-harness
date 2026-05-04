# @lightfastai/dev-services

API-first local development service helpers for Lightfast worktrees.

This package does not ship a CLI. Use `@lightfastai/dev-cli` for the `lightfast-dev` harness, or import these APIs directly from repo-local orchestration code.

## Responsibilities

- Inngest Dev Server serve-endpoint sync.
- Shared local Postgres container and per-worktree database naming.
- Shared Redis Stack plus Upstash-compatible REST proxy.
- Setup and doctor report APIs for service readiness.

Worktree identity and `lightfast.dev.json` discovery live in `@lightfastai/dev-core`.

## API

```ts
import {
  runDevServicesSetup,
  runDevServicesDoctor,
  resolveDevPostgresConfig,
  resolveDevRedisConfig,
  startInngestDevSync,
} from "@lightfastai/dev-services";
```

For command-line usage, install `@lightfastai/dev-cli` and use:

```sh
lightfast-dev setup
lightfast-dev doctor
lightfast-dev postgres url
lightfast-dev redis ping
```

## Publishing

Before publishing, update `packages/dev-services/package.json`, then run:

```sh
pnpm --filter @lightfastai/dev-services release:check
pnpm --filter @lightfastai/dev-services publish:dry-run
pnpm --filter @lightfastai/dev-services publish:npm
```
