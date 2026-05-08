---
"@lightfastai/dev-proxy": minor
"@lightfastai/dev-cli": minor
"@lightfastai/dev-core": minor
"@lightfastai/dev-services": minor
---

feat(dev-proxy)!: host-keyed port allocation; drop `devPort` from apps registry

BREAKING: `apps[<name>].devPort` is no longer accepted in `lightfast.dev.json`. The dev-proxy now derives every app's port from `(host, appName)` via `choosePort` — the same primitive `resolveLocalProxyPort` already used for the MFE proxy port. Seed: `host === baseHost ? appName : ${host}:${appName}`. Primary-worktree ports stay deterministic across restarts; linked worktrees automatically get distinct ports because their host carries a per-worktree prefix. The `choosePort` `portAvailable` probe gives free birthday-paradox protection — a rare hash collision slides past the occupied port instead of failing.

This unblocks concurrent multi-worktree development. Two worktrees can run `pnpm dev` simultaneously without `next dev` colliding on shared TCP ports.

Migration: remove every `devPort` field from your `lightfast.dev.json` `apps` entries. The schema rejects the field via `additionalProperties: false`; the runtime loader also throws an actionable error pointing at `apps.<name>.devPort` if any are left. Drop any hardcoded `--port <n>` flags from app `dev` scripts; portless injects `PORT` via `--app-port <hash>` automatically.

New exports: `resolveAppPort`, `resolveBaseHost`. Removed types: `AppRegistryEntryConfig.devPort`, `AppEntry.devPort`.
