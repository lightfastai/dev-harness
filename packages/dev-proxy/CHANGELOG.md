# @lightfastai/dev-proxy

## 0.3.0

### Minor Changes

- 4fb2f77: feat(dev-proxy): unified apps registry supports MFE and non-MFE apps

  BREAKING: `lightfast.dev.json` now requires a top-level `apps` registry; deriving from `microfrontends.json` is no longer supported. Each entry declares `packageName`, `devPort`, and a required `mfe` flag. `microfrontends.json` is now the path-routing spec only — the MFE proxy's `applications` map is synthesized from the registry's `apps[mfe=true]` entries.

  BREAKING: `microfrontends.apps` override map is removed; its `portlessName` override moves into the registry as `apps[<name>].portlessName`.

  `resolvePortlessAppUrl` is the new canonical name for the URL resolver (`resolvePortlessApplicationUrl` is kept as an alias for one minor; remove in the next bump).

  Non-MFE apps register portless subdomains and participate in the dev-origin allowlist without joining the @vercel/microfrontends mesh. The supervisor (`startDevProxyTurboCommand`) now skips spawning the MFE proxy and the aggregate-hostname route when zero MFE apps are local, emitting a warning that `https://<portless-name>.<tld>` will not resolve in that mode.

### Patch Changes

- Updated dependencies [4fb2f77]
  - @lightfastai/dev-core@0.3.0
