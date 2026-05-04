# @lightfastai/dev-cli

Thin CLI harness for the Lightfast local development API packages.

The CLI owns argument parsing, terminal output, signal forwarding, and process exit codes. Implementation logic lives in:

- `@lightfastai/dev-core`
- `@lightfastai/dev-proxy`
- `@lightfastai/dev-services`

Use the `lightfast-dev` bin from repo scripts:

```sh
lightfast-dev dev --mfe-app app --mfe-app www -- turbo run dev
lightfast-dev setup
lightfast-dev doctor
lightfast-dev proxy url --app app
```
