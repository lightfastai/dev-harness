# @lightfastai/related-projects

Development helpers for Lightfast projects that use Portless with Vercel Microfrontends.

## Requirements

- Node.js 22 or newer.
- A `related-projects.json` file for CLI commands and API helpers that load configuration from disk.
- A Vercel Microfrontends config file at the path named by `microfrontends.config`.

The package bin imports `dist/cli.js`, so build the package before using the CLI from this monorepo checkout:

```sh
pnpm --filter @lightfastai/related-projects build
```

## Publishing

This package is set up for local npm publishing. There is no GitHub Actions release flow.

Before publishing, update the package version in `packages/related-projects/package.json`, then run the local release check from the repo root:

```sh
pnpm related-projects:release:check
```

The release check typechecks, runs the test suite, builds `dist`, and verifies the npm tarball contents with `npm pack --dry-run`.

To inspect the publish without uploading:

```sh
pnpm related-projects:publish:dry-run
```

To publish to npm:

```sh
npm whoami
pnpm related-projects:publish
```

The package publishes as public to `https://registry.npmjs.org/` using the `latest` dist tag unless a different tag is supplied directly to `npm publish`.

## Entrypoints

Use `@lightfastai/related-projects/next` from `next.config.ts`. It is the only entrypoint that is safe for Next config loading and supports both ESM `import` and CommonJS `require`.

Use `@lightfastai/related-projects/related-projects` from ESM app or server runtime modules. It intentionally does not provide a CommonJS export and should not be loaded from `next.config.ts`.

The root `@lightfastai/related-projects` entrypoint exports the Portless and Microfrontends runtime helpers for ESM consumers.

## Configuration

The config loader searches upward from the current working directory for `related-projects.json`. Pass `--config <path>` to the CLI, or `configPath` to API helpers, to use a specific file.

The current repo config is:

```json
{
  "$schema": "./node_modules/@lightfastai/related-projects/schema/config.schema.json",
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

Supported config sections:

- `portless.name`: base Portless route name. Default: `mfe`.
- `portless.port`: Portless proxy port. Default: `1355`.
- `portless.https`: whether generated Portless URLs use HTTPS. Default: `false`.
- `portless.tld`: Portless top-level domain. Default: `localhost`.
- `microfrontends.config`: path to the Vercel Microfrontends JSON config. Default: `microfrontends.json`.
- `microfrontends.apps`: per-application overrides. A string value is treated as an app directory. An object may set `dir`, `path`, or `portlessName`.
- `microfrontends.proxyPortRange`: `{ "min": number, "max": number }` range for the generated local proxy port. Default: `9000` through `9999`.

## Next.js

Wrap a Vercel Microfrontends Next config with `withPortlessMfeDev`:

```ts
import type { NextConfig } from "next";
import { withMicrofrontends } from "@vercel/microfrontends/next/config";
import { withPortlessMfeDev } from "@lightfastai/related-projects/next";

const nextConfig: NextConfig = {};

export default withPortlessMfeDev(withMicrofrontends(nextConfig));
```

`withPortlessMfeDev` adds `allowedDevOrigins` entries for the configured Portless host and for each application in the configured Vercel Microfrontends file. Wildcard origins are included by default. Existing `allowedDevOrigins` entries are preserved.

For Next.js Server Actions behind the local Microfrontends proxy, use `getPortlessMfeDevOrigins({ includePort: "both" })` in `experimental.serverActions.allowedOrigins`. This includes bare HTTPS hosts such as `lightfast.localhost` and explicit-port hosts such as `lightfast.localhost:1355` without allowing unsafe values like `Origin: null`.

## CLI

The package installs the `portless-mfe` bin.

Current repo scripts use:

```sh
pnpm dev
pnpm dev:app
pnpm dev:www
pnpm mfe:url
```

Those scripts build this package first, then call `portless-mfe`.

For the normal Turbo dev flow, keep the source Vercel Microfrontends config at the path named by `microfrontends.config`. In this sandbox that file is `microfrontends.json` at the repo root. `portless-mfe dev` writes `microfrontends.local.json` next to that source file and injects the generated path into `VC_MICROFRONTENDS_CONFIG`.

When the wrapped command is a Turbo dev command, Turbo owns the local Microfrontends proxy. `portless-mfe` still starts bridge servers for each local app so the generated `development.local` ports can forward to the app-specific Portless URLs:

```sh
pnpm dev
pnpm dev:app
pnpm dev:www
```

For non-Turbo dev commands, `portless-mfe dev` starts the Vercel Microfrontends proxy runtime itself.

Available commands:

```sh
portless-mfe turbo [--name <name>] [--local-app <name>] run dev [...turbo args]
portless-mfe dev [--local-app <name>] -- <command> [...args]
portless-mfe run [--name <name>] [--local-app <name>] -- <command> [...args]
portless-mfe proxy [--local-app <name>]
portless-mfe url [--app <name>] [--path <path>] [--json]
portless-mfe identity [--path <path>] [--app-name <name>] [--json]
```

Command behavior:

- `turbo`: starts the Portless proxy, then runs `portless-mfe dev` through `portless run`. Turbo dev commands get `--env-mode=loose` unless an env mode is already present.
- `dev`: generates `microfrontends.local.json` next to the configured Vercel Microfrontends config, sets the local microfrontends environment variables, starts local app bridge servers, then runs the command after `--`. For non-Turbo commands it also starts the Vercel Microfrontends proxy runtime.
- `run`: starts the Portless proxy, then runs `portless-mfe dev` through `portless run` for the command after `--`.
- `proxy`: generates the local microfrontends config and starts the Vercel Microfrontends proxy runtime.
- `url`: prints the resolved Portless URL. Pass `--app <name>` to resolve an application URL from the Vercel Microfrontends config.
- `identity`: prints the resolved runtime identity name. Pass `--json` to include `name`, `baseName`, `targetUrl`, and `worktreePrefix` when a worktree prefix is present.

Options accepted by one or more commands:

- `--config <path>`: path to `related-projects.json`.
- `--name <name>`: Portless base route name.
- `--local-app <name>`: limit local microfrontend handling to one application. Repeat the flag for multiple apps.
- `--path <path>`: append a path to the resolved Portless URL.
- `--target-url <url>`: bypass Portless URL resolution and use an explicit target URL.
- `--json`: print JSON for commands that support it.

When `dev` or `proxy` generates local microfrontends state, it sets:

- `MFE_LOCAL_PROXY_PORT`
- `MFE_DISABLE_LOCAL_PROXY_REWRITE`
- `PORTLESS_MFE_LOCAL_APPS`
- `VC_MICROFRONTENDS_CONFIG`
- `VC_MICROFRONTENDS_CONFIG_FILE_NAME`

The generated local config also adds each routed app's asset prefix path, such as `/vc-ap-<hash>/:path*`, to that app's routing. This keeps Next.js static chunks, CSS, and images from falling through to the default app when the source config only lists user-facing routes such as `/docs`.

## API

Root exports:

```ts
import {
  createVercelMicrofrontendsDevConfig,
  resolvePortlessApplicationUrl,
  resolvePortlessMfeRuntime,
  resolvePortlessMfeUrl,
  resolvePortlessUrl,
  resolveRuntimeIdentity,
  resolveTargetUrl,
} from "@lightfastai/related-projects";
```

Next.js exports:

```ts
import {
  getPortlessMfeDevOrigins,
  withPortlessMfeDev,
} from "@lightfastai/related-projects/next";
```

Related-project URL helper:

```ts
import { resolveRelatedProjectUrl } from "@lightfastai/related-projects/related-projects";

const wwwDefaultHost = resolveRelatedProjectUrl("www");
```

`resolveRelatedProjectUrl` reads the configured Vercel Microfrontends file and resolves the requested application by name. When `NODE_ENV` is `development`, it returns the local Portless application URL. Otherwise it returns the application's `development.fallback`, normalized to a full URL. Apps can use this as the `defaultHost` for `withRelatedProject`; this package does not import or call `@vercel/related-projects`.

Config schema export:

```json
"$schema": "./node_modules/@lightfastai/related-projects/schema/config.schema.json"
```
