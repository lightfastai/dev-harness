# @lightfastai/dev-core

Core local development primitives for Lightfast worktrees.

This package owns worktree identity, prefix detection, and the small shared project identity read from `related-projects.json`. It does not know about Portless runtime behavior, Vercel Microfrontends, Inngest, or app-specific service wiring.

## Usage

Install the package where code needs worktree-aware runtime names:

```sh
pnpm add @lightfastai/dev-core
```

Derive a stable runtime name:

```ts
import { resolveWorktreeRuntimeName } from "@lightfastai/dev-core";

export const inngestAppId = resolveWorktreeRuntimeName("lightfast-app");
```

In the main checkout this returns `lightfast-app`. In a linked worktree on a branch such as `feature/inngest-ui`, it returns `lightfast-app-inngest-ui`.

For structured access:

```ts
import { resolveWorktreeIdentity } from "@lightfastai/dev-core";

const identity = resolveWorktreeIdentity({ baseName: "lightfast-platform" });
// { name, baseName, worktreePrefix }
```

Resolve the shared local-dev project identity from `related-projects.json`:

```ts
import { resolveDevProjectConfig } from "@lightfastai/dev-core";

const project = resolveDevProjectConfig();
// { root, configPath, name } where name is related-projects.json portless.name
```

## API

```ts
import {
  branchToPrefix,
  defaultDetectWorktreePrefix,
  resolveDevProjectConfig,
  resolveWorktreeIdentity,
  resolveWorktreeRuntimeName,
  sanitizeWorktreePrefix,
} from "@lightfastai/dev-core";
```

`defaultDetectWorktreePrefix` first asks `git worktree` for linked-worktree state, then falls back to reading a `.git` file that points into a `worktrees/` directory. Main, master, and detached HEAD states do not produce a prefix.

## Publishing

Before publishing, update `packages/dev-core/package.json`, then run:

```sh
pnpm --filter @lightfastai/dev-core release:check
```

To inspect the publish without uploading:

```sh
pnpm --filter @lightfastai/dev-core publish:dry-run
```

To publish to npm:

```sh
npm whoami
pnpm --filter @lightfastai/dev-core publish:npm
```
