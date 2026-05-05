# @lightfastai/dev-proxy

API-first local development proxy helpers for Lightfast projects that use Portless with Vercel Microfrontends.

This package does not ship a CLI. Use `@lightfastai/dev-cli` for the `lightfast-dev` harness, or import these APIs directly from repo-local orchestration code.

## Entrypoints

Use `@lightfastai/dev-proxy/next` from `next.config.ts`. It is safe for Next config loading and supports both ESM `import` and CommonJS `require`.

Use `@lightfastai/dev-proxy/projects` from ESM app or server runtime modules that need related deployment or local Portless application URLs.

The root `@lightfastai/dev-proxy` entrypoint exports Portless, Microfrontends, and process runtime helpers for ESM consumers.

## Configuration

The config loader searches upward from the current working directory for `lightfast.dev.json`. Pass `configPath` to API helpers to use a specific file.

```json
{
  "$schema": "./node_modules/@lightfastai/dev-proxy/schema/config.schema.json",
  "portless": {
    "name": "mfe",
    "port": 1355,
    "https": false
  },
  "microfrontends": {
    "config": "microfrontends.json",
    "apps": {}
  }
}
```

## API

```ts
import {
  createVercelMicrofrontendsDevConfig,
  resolvePortlessApplicationUrl,
  resolvePortlessMfeRuntime,
  resolvePortlessMfeUrl,
  startDevProxyAppCommand,
  startDevProxyDevCommand,
  startDevProxyRuntime,
  startDevProxyTurboCommand,
} from "@lightfastai/dev-proxy";
```

Next.js exports:

```ts
import {
  getPortlessProxyOrigins,
  withPortlessProxy,
} from "@lightfastai/dev-proxy/next";
```

`withPortlessProxy` populates `allowedDevOrigins` for HMR. Pass `{ serverActions: true }` to also append origins to `experimental.serverActions.allowedOrigins` (browsers strip `:443` from HTTPS Origin headers, so the bare-host variant is enough by default). Pass `{ serverActions: { includePort: "both" } }` to include both port and no-port variants on the Server Actions surface.

Project URL helpers:

```ts
import { resolveProjectUrl, withProject } from "@lightfastai/dev-proxy/projects";
```

`resolveProjectUrl` reads the configured Vercel Microfrontends file and resolves the requested application by name. In development it returns the local Portless application URL. Outside development it returns the application's `development.fallback`, normalized to a full URL.

`withProject` is the small Vercel deployment-neighbor resolver. It reads `VERCEL_RELATED_PROJECTS` when Vercel provides it and otherwise returns the supplied default host.

## Publishing

Before publishing, update `packages/dev-proxy/package.json`, then run:

```sh
pnpm dev-proxy:release:check
pnpm dev-proxy:publish:dry-run
pnpm dev-proxy:publish
```
