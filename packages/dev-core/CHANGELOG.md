# @lightfastai/dev-core

## 0.4.0

### Minor Changes

- 97c0a66: feat(dev-proxy)!: host-keyed port allocation; drop `devPort` from apps registry

  BREAKING: `apps[<name>].devPort` is no longer accepted in `lightfast.dev.json`. The dev-proxy now derives every app's port from `(host, appName)` via `choosePort` — the same primitive `resolveLocalProxyPort` already used for the MFE proxy port. Seed: `host === baseHost ? appName : ${host}:${appName}`. Primary-worktree ports stay deterministic across restarts; linked worktrees automatically get distinct ports because their host carries a per-worktree prefix. The `choosePort` `portAvailable` probe gives free birthday-paradox protection — a rare hash collision slides past the occupied port instead of failing.

  This unblocks concurrent multi-worktree development. Two worktrees can run `pnpm dev` simultaneously without `next dev` colliding on shared TCP ports.

  Migration: remove every `devPort` field from your `lightfast.dev.json` `apps` entries. The schema rejects the field via `additionalProperties: false`; the runtime loader also throws an actionable error pointing at `apps.<name>.devPort` if any are left. Drop any hardcoded `--port <n>` flags from app `dev` scripts; portless injects `PORT` via `--app-port <hash>` automatically.

  New exports: `resolveAppPort`, `resolveBaseHost`. Removed types: `AppRegistryEntryConfig.devPort`, `AppEntry.devPort`.

## 0.3.1

### Patch Changes

- c0dba25: fix(dev-proxy): drop incompatible `[key: string]: unknown` index signatures from `NextConfigWithPortlessProxy.experimental`

  The 0.3.0 release widened `NextConfigWithPortlessProxy.experimental` (and `experimental.serverActions`) with `[key: string]: unknown` index signatures. Next's `ExperimentalConfig` does not declare an index signature, so passing a real `NextConfig` through `withPortlessProxy` failed with `error TS2345: Index signature for type 'string' is missing in type 'ExperimentalConfig'`. Removing the index signatures restores compatibility with downstream Next 16 configs.

## 0.3.0

### Minor Changes

- 4fb2f77: feat(dev-proxy): unified apps registry supports MFE and non-MFE apps

  BREAKING: `lightfast.dev.json` now requires a top-level `apps` registry; deriving from `microfrontends.json` is no longer supported. Each entry declares `packageName`, `devPort`, and a required `mfe` flag. `microfrontends.json` is now the path-routing spec only — the MFE proxy's `applications` map is synthesized from the registry's `apps[mfe=true]` entries.

  BREAKING: `microfrontends.apps` override map is removed; its `portlessName` override moves into the registry as `apps[<name>].portlessName`.

  `resolvePortlessAppUrl` is the new canonical name for the URL resolver (`resolvePortlessApplicationUrl` is kept as an alias for one minor; remove in the next bump).

  Non-MFE apps register portless subdomains and participate in the dev-origin allowlist without joining the @vercel/microfrontends mesh. The supervisor (`startDevProxyTurboCommand`) now skips spawning the MFE proxy and the aggregate-hostname route when zero MFE apps are local, emitting a warning that `https://<portless-name>.<tld>` will not resolve in that mode.
