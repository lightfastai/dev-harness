---
"@lightfastai/dev-proxy": patch
---

Fix `proxy app-runtime`/`next dev` orphans on dev tree shutdown by keeping the inner `proxy app → proxy app-runtime → next dev` chain in the parent's process group instead of giving each its own pgrp leader. The outer `proxy turbo` and aux spawns (microfrontends proxy, portless route stub) remain detached so the top-level runtime can still group-kill them; only the leaf chain that is itself signalled via the parent pgrp loses its pgrp-leader status. Resolves a regression where Ctrl+C against `pnpm dev` would consistently leak `lightfast-dev proxy app-runtime → next dev → next-server` for one of the apps (in practice, the one losing the drain race), holding its dev port bound.
