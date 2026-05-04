# @lightfastai/dev-services

Machine-level local development service helpers for Lightfast worktrees.

This package owns reusable service helpers that are not specific to Portless or Vercel Microfrontends:

- Inngest Dev Server serve-endpoint sync.
- Wrapper CLI commands for local service coordination.
- Consumer guidance for singleton local services such as Inngest, Redis, and Drizzle Studio.

Worktree identity library APIs live in `@lightfastai/dev-core`, not this package.

The CLI form is available when shell scripts need the same value:

```sh
lightfast-dev-services identity --app-name lightfast-app --json
```

## Inngest

Run one Inngest Dev Server per machine:

```sh
npx inngest-cli@latest dev
```

If the consuming dev wrapper can discover app serve URLs, sync them into that singleton by calling `PUT` on each app's serve endpoint. This package exposes helpers for that flow:

```ts
import {
  buildInngestDevSyncTargets,
  startInngestDevSync,
} from "@lightfastai/dev-services";

const runtime = startInngestDevSync({
  targets: buildInngestDevSyncTargets({
    result: {
      appUrls: {
        app: "http://app.mfe.localhost:1355/",
        www: "http://www.mfe.localhost:1355/",
      },
      localAppNames: ["app", "www"],
    },
  }),
});

runtime.stop();
```

Apps without an Inngest route are skipped when they return `404` or `405`; transient failures are retried. Set `PORTLESS_MFE_INNGEST_SYNC=0` to disable wrappers that respect `isInngestDevSyncEnabled`.

For Portless MFE repos that also install `@lightfastai/related-projects`, wrap the dev command so the service package owns Inngest sync while the MFE package stays focused on URL/proxy concerns:

```sh
lightfast-dev-services inngest-sync --mfe-app app --mfe-app www -- \
  portless-mfe turbo run dev --filter=app --filter=www
```

Use `--app-url app=http://app.mfe.localhost:1355/` for non-MFE commands or when app URLs are known explicitly. Pass `--no-inngest-sync` to run the wrapped command without sync.

If the Inngest UI collapses multiple worktrees that expose the same app ID, use `resolveWorktreeRuntimeName("lightfast-app")` and `resolveWorktreeRuntimeName("lightfast-platform")` from `@lightfastai/dev-core` in the consuming app's local Inngest clients. Do not add a checked-in `inngest.json` just for worktree discovery.

## Drizzle Studio

Run one Drizzle Studio process per machine, normally on Drizzle's default `127.0.0.1:4983`. Worktrees should reuse that process instead of starting their own Studio sidecars.

## Postgres

Run one Docker Postgres container per machine and give each worktree its own database:

```sh
pnpm db:up
pnpm db:create
pnpm db:url
```

The default service is `postgres:17-alpine` in a `lightfast-postgres` container with the `lightfast-postgres-data` volume. `DATABASE_URL` wins when set, but it must point at localhost. Otherwise the database name is derived from the base name, worktree identity, and cwd hash.

Useful overrides:

- `LIGHTFAST_DEV_DATABASE_NAME`
- `LIGHTFAST_DEV_POSTGRES_PORT`
- `LIGHTFAST_DEV_POSTGRES_CONTAINER`
- `LIGHTFAST_DEV_POSTGRES_VOLUME`
- `LIGHTFAST_DEV_POSTGRES_IMAGE`

## Redis

Run one Redis Stack container and one Upstash-compatible HTTP proxy per machine:

```sh
pnpm redis:up
pnpm redis:ping
pnpm redis:url
```

The default service uses `redis/redis-stack-server:6.2.6-v6` in a `lightfast-redis` container and `hiett/serverless-redis-http:latest` in a `lightfast-redis-http` container. Worktrees share those containers and isolate data with a derived key prefix based on the base name, worktree identity, and cwd hash.

Useful overrides:

- `LIGHTFAST_DEV_REDIS_KEY_PREFIX`
- `LIGHTFAST_DEV_REDIS_REST_PORT`
- `LIGHTFAST_DEV_REDIS_REST_TOKEN`
- `LIGHTFAST_DEV_REDIS_CONTAINER`
- `LIGHTFAST_DEV_REDIS_HTTP_CONTAINER`
- `LIGHTFAST_DEV_REDIS_NETWORK`

## Publishing

Before publishing, update `packages/dev-services/package.json`, then run:

```sh
pnpm --filter @lightfastai/dev-services release:check
```

To inspect the publish without uploading:

```sh
pnpm --filter @lightfastai/dev-services publish:dry-run
```

To publish to npm:

```sh
npm whoami
pnpm --filter @lightfastai/dev-services publish:npm
```
