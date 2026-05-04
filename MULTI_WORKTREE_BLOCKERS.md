# Multi-Worktree Desktop Blockers

This file tracks the real blockers found while reviewing
`/Users/jeevanpillay/Code/@lightfastai/lightfast/apps/desktop` for concurrent
multi-worktree development.

The goal of this sandbox is to solve these blockers one by one, then port the
proven shape back into Lightfast.

## Target Outcome

Two or more worktrees can run the full local stack and desktop app at the same
time without sharing runtime state, stealing auth callbacks, colliding on ports,
or requiring per-run manual env edits.

Minimum acceptance test:

1. Start two worktrees concurrently.
2. Start the app/www/platform stack in both.
3. Start a desktop dev instance in both.
4. Sign in through desktop A and desktop B.
5. Verify callback A lands only in desktop A, callback B lands only in desktop B.
6. Verify each desktop has its own auth store, settings, window state, logs, and
   browser storage.

Scope notes:

- This sandbox currently models `apps/app`, `apps/www`, and `apps/desktop`.
  It does not yet contain a real `apps/platform`; platform findings below come
  from `/Users/jeevanpillay/Code/@lightfastai/lightfast`.
- The sandbox desktop is a lightweight Electron probe. It does not yet exercise
  Lightfast's production-like custom protocol, PKCE, tray, global shortcut, or
  Vite renderer surfaces.

## Blockers

### B1. Shared Desktop Identity And User Data

**Status:** open

Current desktop dev uses one unpackaged product identity: `Lightfast Dev`.
That makes all worktrees share the same Electron `userData` directory.

Shared state includes:

- `auth.bin`
- `settings.json`
- `window-state.json`
- Chromium storage and singleton locks
- safeStorage-backed persisted tokens

**Why it blocks multi-worktree:** two desktop processes cannot represent two
independent worktrees if they read and write the same app data. A sign-in,
sign-out, stale singleton lock, settings change, or window move in one worktree
can affect another.

**Fix direction:** derive a stable dev instance id from the worktree identity,
then use it in the dev app name and/or `userData` path.

Candidate:

```text
LIGHTFAST_WORKTREE_ID=<sanitized branch or hash>
userData = appData / "Lightfast Dev" / LIGHTFAST_WORKTREE_ID
```

Sandbox detail: the current sandbox desktop derives its identity from the
resolved target URL and lets `DESKTOP_NAME` override it. That is useful for a
probe, but it is not a true worktree primitive. A stale `PORTLESS_URL`,
canonical `DESKTOP_TARGET_URL`, or reused `DESKTOP_NAME` can collapse multiple
worktrees back into one Electron `userData` directory.

**Done when:**

- Two desktop dev instances can run at once.
- Each instance writes auth/settings/window state under a different directory.
- Restarting one instance preserves only its own state.

### B2. Single Global Dev URL Scheme

**Status:** open

Current dev auth uses one global OS protocol scheme:

```text
lightfast-dev://auth/callback
```

OS protocol handlers are global. Only one running app can be the effective
recipient for a scheme at a time.

**Why it blocks multi-worktree:** if desktop A and desktop B are both running,
the browser callback can be delivered to the wrong process. The wrong desktop
will reject the state, focus the wrong window, and the correct desktop will
eventually time out.

**Fix direction:** make the dev callback target worktree-scoped.

Preferred candidate:

```text
lightfast-dev-<worktree-id>://auth/callback
```

Alternative candidate:

```text
http://127.0.0.1:<per-instance-port>/callback
```

The custom-scheme option keeps parity with production, but requires generated
dev redirect allowlists and careful protocol registration. The loopback option
is easier to isolate but diverges from the current PKCE custom-scheme flow.

Additional Lightfast blocker: the app-side desktop auth bridge currently
allowlists only fixed redirect URIs:

```text
lightfast://auth/callback
lightfast-dev://auth/callback
```

A worktree-scoped scheme also requires generated allowlists in the desktop auth
page and `/api/desktop/auth/code` route. The sandbox does not yet test this
because its desktop probe has no `setAsDefaultProtocolClient`, `open-url`,
`second-instance`, PKCE state, or callback dispatch harness.

**Done when:**

- Two in-flight desktop sign-ins can complete concurrently.
- Dispatching desktop A's callback never triggers desktop B's listener.
- Tests cover scheme generation and wrong-scheme rejection.

### B3. Fixed Local Stack Ports

**Status:** open

The stack currently assumes fixed local ports such as:

- app: `4107`
- www: `4101`
- platform: `4112`
- microfrontends proxy: `3024`
- portless public proxy: `1355`
- desktop renderer: `5173`

**Why it blocks multi-worktree:** the second worktree cannot bind the same TCP
ports. Even if a named local domain is used, the underlying dev processes still
need isolated ports.

There are two proxy layers to reason about:

- Portless public router: e.g. `mfe.localhost:1355` or
  `<worktree>.mfe.localhost:1355`.
- Vercel Microfrontends local proxy: generated as `localProxyPort`, currently
  equivalent to the old canonical `3024` role.

Both must be instance-scoped, or the design must explicitly choose one shared
global router with instance-aware route registration and cleanup.

Standalone platform is a separate case. In real Lightfast, `apps/platform`
does not run through `withMicrofrontends`; it binds `4112` directly. It needs a
generated port and public origin from the same manifest as app/www/desktop, not
only a generated MFE config.

**Fix direction:** use a worktree wrapper that generates per-worktree ports and
feeds them into the microfrontends config and dev processes.

Existing sandbox primitives to prove/extend:

- `portless-mfe.config.json`
- `packages/portless-mfe-dev`
- `apps/app/microfrontends.json`

Critical MFE invariant: generated `development.local` must point at the actual
Next dev listener for each app, or at an app-local URL that `microfrontends
port` can use to bind Next. It must not accidentally point every app at the
public Portless URL. Direct `pnpm --filter app dev` and `pnpm --filter www dev`
are not multi-worktree-safe unless the launcher exports the generated
`VC_MICROFRONTENDS_CONFIG`, `VC_MICROFRONTENDS_CONFIG_FILE_NAME`, and proxy
port env.

Generated config should also be runner-safe. `microfrontends.local.json` is
per-worktree because it lives in each worktree, but it is not per launch inside
one worktree. Concurrent launchers can overwrite the same file and the same
`.tmp` path unless the runner prevents or scopes that.

**Done when:**

- Two worktrees can run app/www/platform/proxy concurrently.
- The primary worktree can keep canonical ports for compatibility.
- Linked worktrees get deterministic non-conflicting ports.
- `development.local` values are validated against actual running app ports.
- Platform has the same generated instance metadata as the MFE apps.

### B4. Desktop API Origin Is Static Unless Manually Overridden

**Status:** open

Desktop has no request context, so it cannot infer the current worktree origin
from incoming headers. It currently defaults to the canonical mesh origin.

**Why it blocks multi-worktree:** desktop B may talk to desktop A's API stack if
`LIGHTFAST_API_URL` and `VITE_LIGHTFAST_API_URL` are not set correctly for that
worktree.

Related URL assumptions are spread through the web stack too:

- app -> platform rewrites fall back to `http://localhost:4112`
- platform -> app CORS identity falls back to `http://localhost:3024`
- www -> app links fall back to `http://localhost:4107`
- app tRPC's generic non-browser fallback is `http://localhost:${PORT ?? 4104}`
- platform tRPC's generic non-browser fallback is
  `http://localhost:${PORT ?? 4112}`

Changing only process ports is not enough; every caller must receive the same
instance manifest.

`@vercel/related-projects` does not currently solve local worktree routing by
itself. Its `withRelatedProject()` helper only uses `VERCEL_RELATED_PROJECTS`
for `VERCEL_ENV=preview` or `VERCEL_ENV=production`; local dev falls back to
the hardcoded defaults above. The worktree launcher needs either generated
local defaults or a local-aware wrapper.

**Fix direction:** the same worktree launcher that starts the web stack should
emit the desktop API origin.

Candidate:

```text
LIGHTFAST_API_URL=https://<worktree-id>.lightfast.localhost
VITE_LIGHTFAST_API_URL=https://<worktree-id>.lightfast.localhost
```

For bare localhost fallback, use the generated proxy port instead.

Sandbox note: the current sandbox desktop fetches `/api/ping` relative to the
loaded target origin, which is a good proof pattern, but it does not exercise
Lightfast's static `LIGHTFAST_API_URL` / `VITE_LIGHTFAST_API_URL` defaults.

**Done when:**

- Desktop A's renderer and main process call only API A.
- Desktop B's renderer and main process call only API B.
- CSP `connect-src` includes the selected worktree origin.

### B5. CORS And Server Action Origins Are Too Narrow

**Status:** open

Current app/platform CORS and Server Action origin checks are designed for one
canonical local origin.

**Why it blocks multi-worktree:** worktree-aware origins such as
`https://feature-x.lightfast.localhost` or generated localhost ports can be
rejected before app code runs.

**Fix direction:** request-context code should validate origins by local pattern,
not by a module-level static set.

Candidates:

- allow `localhost:<any-port>` in dev
- allow any host ending in `.localhost` in dev
- keep production strict to `lightfast.ai` / `*.lightfast.ai`

Specific gaps to fix:

- app tRPC dev CORS currently whitelists canonical `3024` and desktop renderer
  `5173`, not generated worktree origins.
- platform tRPC CORS is exact `origin === appUrl`; generated app origins fail
  unless `appUrl` is derived from the same manifest.
- platform HTTP tRPC is only part of the story. Many app -> platform calls use
  `@repo/platform-trpc/caller`, which imports `@api/platform` and executes the
  platform router in-process inside the app server. Those calls bypass HTTP
  ports and CORS, but still share platform env, DB, Redis, Inngest, provider
  configs, and service JWT settings.
- app Server Actions allow `localhost:*` in dev, which does not include
  `feature.lightfast.localhost`.
- Next `allowedDevOrigins` only proves dev/HMR origin acceptance. It does not
  prove route-level CORS or Server Action acceptance.
- The sandbox ESM and CJS Next helpers must stay behaviorally identical. ESM
  currently knows about app-specific MFE origins; any CJS fallback must not
  silently omit them.

**Done when:**

- tRPC preflights pass from every generated worktree desktop origin.
- platform tRPC accepts the generated app origin.
- in-process app -> platform tRPC calls use the same worktree manifest and
  state namespace as the standalone platform process.
- Server Actions accept `*.localhost` worktree origins.

### B6. Agent Launch And Sign-In Runbooks Are Not Instance-Scoped

**Status:** open

Agent workflows currently assume one desktop instance, one log path, one mesh
origin, and one renderer port.

Examples that must become instance-aware:

- `/tmp/lightfast-desktop.log`
- `http://localhost:5173`
- `http://localhost:3024`
- `~/Library/Application Support/Lightfast Dev`
- `http://localhost:4112`
- `~/.portless/routes.json`
- `~/.portless/proxy.log`

**Why it blocks multi-worktree:** automated sign-in and verification can read
the wrong log, drive the wrong renderer, or delete the wrong auth store.

**Fix direction:** every agent-run desktop command should receive a worktree id
and derive log paths, ports, and state paths from it.

The same applies to web/background runners. In real Lightfast, `dev:inngest`
uses fixed URLs for app and platform handlers, and platform's Turbo task starts
that app Inngest task. The worktree launcher must generate those URLs instead
of leaving Inngest pointed at canonical `3024` / `4112`.

Portless state is also global by default. If the design uses one shared
Portless router, route registration, pruning, logs, locks, and cleanup must be
safe for multiple worktrees. If not, `PORTLESS_STATE_DIR` and the public proxy
port need to be instance-scoped together.

**Done when:**

- Agent can start desktop A and desktop B independently.
- Agent can sign in desktop A without observing or touching desktop B.
- Cleanup commands target only the selected instance.
- Inngest and other background runners call only endpoints for their worktree.

### B7. Global Shortcuts And Menu-Bar State Are Shared OS Resources

**Status:** open

Desktop registers global shortcuts and menu bar/tray state as if only one dev
instance exists.

**Why it blocks multi-worktree:** only one process can own a global shortcut,
and menu-bar behavior becomes ambiguous with multiple dev instances.

**Fix direction:** disable global shortcuts by default for non-primary dev
instances, or make the worktree launcher elect one instance as interactive.

**Done when:**

- Starting two desktop dev instances does not fail or behave unpredictably due
  to global shortcut registration.
- The primary instance behavior remains convenient for normal single-worktree
  development.

### B8. Platform OAuth And Shared Service State Are Not Worktree-Scoped

**Status:** open

Platform OAuth/connect flows are standalone platform behavior, not MFE routing.
Real Lightfast currently freezes app return origins around canonical local
defaults such as `http://localhost:3024`, and its redirect allowlist accepts
only localhost or URLs that start with the configured app URL.

**Why it blocks multi-worktree:** a connect flow launched from worktree B can
be rejected, or it can complete and redirect back to worktree A's canonical
app. Because OAuth state, token vault writes, DB records, Redis keys, and
Inngest events may share backend services, even a successful flow can mutate
shared state in ways that make verification ambiguous.

Specific state/origin surfaces:

- provider configs build callback URLs from `api/platform/src/lib/related-projects.ts`,
  which falls back to canonical `http://localhost:3024`.
- OAuth redirect validation in `api/platform/src/lib/oauth/authorize.ts`
  accepts `localhost` or URLs prefixed by that configured app URL.
- OAuth state/result Redis keys use the global `gw:` namespace.
- desktop auth codes use the global `desktop_auth_code:` Redis prefix.
- OAuth completion notifications use origin-scoped `BroadcastChannel` /
  `postMessage`; they work only if the callback returns to the initiating
  worktree origin.

**Fix direction:** platform must receive the same worktree manifest as app,
www, desktop, and runners. OAuth state keys, callback redirects, service JWT
audiences, Inngest app names, and any test/dev DB or KV namespace need an
explicit decision: shared by design, or scoped by `LIGHTFAST_WORKTREE_ID`.

**Done when:**

- Platform OAuth authorize/callback returns to the initiating worktree origin.
- Redirect allowlists accept generated local origins in dev only.
- DB/KV/Inngest state is either intentionally shared with collision-resistant
  keys, or isolated per worktree.
- OAuth popup completion updates only the initiating worktree UI.

### B9. Sandbox Coverage And Runner Drift

**Status:** open

This sandbox is the proving ground, but it does not yet cover every real
Lightfast surface:

- no real `apps/platform`
- no custom protocol / PKCE desktop auth harness
- no desktop Vite renderer dev server
- no tray/global shortcut behavior
- no route-level CORS endpoint beyond the simple `api/ping` probe

There is also current implementation drift in the sandbox runner layer:

- `packages/portless-mfe-dev` is actively moving between app port and app URL
  models.
- the CLI, package scripts, generated MFE config, and tests must agree on
  whether `development.local` is a numeric listener port, a localhost URL, or a
  public Portless URL.
- `pnpm --filter @repo/portless-mfe-dev test` should remain the regression gate
  for this model.

**Why it blocks multi-worktree:** the sandbox can appear to prove one layer
while missing the real failure mode in another. Before porting back to
Lightfast, the sandbox needs fixtures or probes for platform, desktop auth,
and runner/env manifest propagation.

**Fix direction:** treat the sandbox as incomplete until it has a first-class
instance manifest and exercises app/www/platform/desktop through the same
generated ports, origins, env vars, and state paths.

**Done when:**

- The sandbox includes or simulates platform as standalone, not only as an MFE
  fixture.
- The portless helper tests pass against the intended port/url model.
- A two-worktree sandbox run covers app/www/platform/desktop and fails if any
  process receives another worktree's origin, port, callback, or state path.

### B10. tRPC Boundary And Service Auth Map Is Ambiguous

**Status:** open

There are three different tRPC execution paths in Lightfast:

- app HTTP tRPC: `apps/app/src/app/(trpc)/api/trpc/[trpc]/route.ts`
- platform HTTP tRPC:
  `apps/platform/src/app/(trpc)/api/trpc/[trpc]/route.ts`
- in-process platform tRPC callers:
  `@repo/platform-trpc/caller` and `@repo/platform-trpc/server`

The in-process callers do not call `http://localhost:4112`; they import
`@api/platform`, sign a short-lived service JWT with `SERVICE_JWT_SECRET`, and
create a router caller in the current process.

**Why it blocks multi-worktree:** fixing platform's standalone port/origin does
not prove app -> platform behavior. Some code paths need generated HTTP origins
and CORS. Other code paths need a generated local state namespace and env set,
because they run platform code inside the app process. If those are not tracked
separately, the acceptance test can pass the wrong layer and still leak through
shared DB, Redis, Inngest, provider config, or service JWT state.

**Fix direction:** the worktree manifest should explicitly list each tRPC
boundary:

- app public origin
- app internal Next listener
- platform public origin
- platform internal Next listener
- desktop renderer origin
- service auth namespace/secret policy
- shared-vs-isolated backend state policy

HTTP tRPC route tests should cover generated `Origin` values. In-process caller
tests should assert the same manifest is used when app code imports platform
code directly.

**Done when:**

- app HTTP tRPC accepts generated desktop/www origins and rejects unrelated
  local origins.
- platform HTTP tRPC accepts only the generated app origin for the same
  worktree.
- app in-process platform callers cannot accidentally use another worktree's
  provider config, Inngest app id, Redis namespace, or service JWT policy.
- the docs distinguish "platform HTTP process" from "platform router imported
  into app".

## Proposed Fix Order

1. **Stabilize the sandbox runner model.** Resolve the current port/url drift
   and make `portless-mfe-dev` tests pass.
2. **Add a worktree identity primitive.** One source of truth for sanitized id,
   generated ports, public local origin, and state paths.
3. **Isolate ports and origins.** Prove two app/www/platform/proxy stacks can
   run concurrently without desktop.
4. **Add platform to the sandbox path.** Platform must be standalone and
   manifest-driven, not hidden inside MFE fixture behavior.
5. **Isolate desktop userData.** Make two desktop instances possible before
   fixing auth.
6. **Make auth callback worktree-scoped.** Custom scheme or loopback, but the
   callback target must be unique per desktop instance.
7. **Widen dev CORS/Server Action checks.** Accept generated local origins while
   keeping production strict.
8. **Update platform OAuth and background runners.** Redirects, Inngest URLs,
   DB/KV namespaces, and service auth must follow the same manifest.
9. **Lock down tRPC boundaries.** Test HTTP CORS origins separately from
   in-process platform callers.
10. **Update agent runbooks.** Make logs, cleanup, renderer URLs, and auth paths
   instance-scoped.
11. **Run the two-worktree acceptance test.** Keep failures recorded here until
    the whole flow passes.

## Open Design Decisions

### D1. Worktree ID Source

Options:

- sanitized branch name
- hash of `git rev-parse --show-toplevel`
- explicit `LIGHTFAST_WORKTREE_ID`

Branch name alone is not enough. `feature/foo` and `bug/foo` both collapse to
`foo` if only the last branch segment is used. Main/master/detached worktrees
can produce no suffix.

Likely answer: explicit env override, otherwise sanitized branch plus short
path hash, otherwise short path hash.

### D2. Dev Auth Callback Transport

Options:

- worktree-scoped custom scheme
- per-instance loopback callback

Likely answer: prefer custom scheme for production parity, but keep loopback as
a fallback if macOS LaunchServices cannot reliably register dynamic dev schemes.

### D3. Portless As Required Or Optional

Options:

- required for all multi-worktree dev
- optional named-domain layer over generated localhost ports

Likely answer: optional for the sandbox until the mechanics are proven; required
only when testing browser-facing worktree domains.

## Evidence From Lightfast Review

Key observed source files in the real repo:

- `apps/desktop/src/main/bootstrap.ts`: sets app name and shared `userData`.
- `apps/desktop/src/main/protocol.ts`: registers `lightfast` or `lightfast-dev`.
- `apps/desktop/src/main/auth-flow.ts`: builds signin URL and exchanges PKCE
  callback.
- `apps/desktop/src/main/auth-store.ts`: persists `auth.bin` under `userData`.
- `apps/desktop/src/main/settings-store.ts`: persists settings under `userData`.
- `apps/desktop/src/main/window-state.ts`: persists window state under
  `userData`.
- `apps/desktop/src/main/shortcuts.ts`: registers global shortcut.
- `apps/app/src/app/(trpc)/api/trpc/[trpc]/route.ts`: static dev CORS origins.
- `apps/platform/src/app/(trpc)/api/trpc/[trpc]/route.ts`: strict app origin
  equality.
- `apps/app/next.config.ts`: Server Actions allowed origins.
- `apps/app/microfrontends.json`: fixed app/www dev ports.
- `apps/app/src/lib/related-projects.ts`: app -> www/platform fallback URLs.
- `apps/www/src/lib/related-projects.ts`: www -> app fallback URL.
- `apps/platform/src/lib/related-projects.ts`: platform -> app fallback URL.
- `api/platform/src/lib/related-projects.ts`: provider callback base URL.
- `packages/app-trpc/src/react.tsx`: app tRPC base URL fallback and credential
  mode.
- `packages/app-trpc/src/desktop.tsx`: desktop tRPC bearer-token headers.
- `packages/platform-trpc/src/react.tsx`: platform tRPC base URL fallback.
- `packages/platform-trpc/src/caller.ts`: in-process platform router caller.
- `packages/platform-trpc/src/server.tsx`: RSC platform router caller.
- `api/platform/src/lib/jwt.ts`: service JWT signing and verification.
- `api/platform/src/lib/cache.ts`: global OAuth Redis key prefixes.
- `apps/app/src/app/api/desktop/auth/lib/code-store.ts`: global desktop auth
  code Redis prefix.
- `apps/app/package.json`: fixed app port and fixed Inngest endpoint URLs.
- `apps/platform/package.json`: fixed standalone platform port.
- `apps/platform/turbo.json`: platform dev starts app Inngest task.
- `apps/app/src/app/api/desktop/auth/code/route.ts`: fixed desktop redirect
  URI allowlist.
- `api/platform/src/lib/oauth/authorize.ts`: platform OAuth redirect allowlist
  and canonical local fallback.
- `api/platform/src/lib/oauth/callback.ts`: platform OAuth callback return
  origin.

## Running Notes

Use this section to append discoveries as the sandbox validates or rejects each
fix shape.

- 2026-05-03: Initial blocker list created from read-only review of Lightfast
  desktop and local dev stack assumptions.
- 2026-05-03: Follow-up multi-agent review added platform standalone coverage,
  two-proxy-layer portless/MFE concerns, branch-id collision risk, app-side
  desktop redirect allowlist work, platform OAuth state/redirect blockers, and
  sandbox runner model drift as a regression gate.
- 2026-05-03: Deeper tRPC/platform pass split platform HTTP tRPC from
  in-process platform router calls, documented `@vercel/related-projects`
  local-dev fallback behavior, and added global Redis/service-auth namespace
  risks for OAuth and desktop auth codes.
