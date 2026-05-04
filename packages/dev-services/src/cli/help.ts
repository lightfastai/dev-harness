export function printHelp(): void {
	console.log(`Usage:
  lightfast-dev-services setup [--json]
  lightfast-dev-services doctor [--postgres-table <name>] [--json]
  lightfast-dev-services identity --app-name <name> [--json]
  lightfast-dev-services inngest-sync [--mfe-app <name>] [--app-url <name=url>] -- <command> [...args]
  lightfast-dev-services postgres-url [--json]
  lightfast-dev-services postgres-up [--json]
  lightfast-dev-services postgres-create [--json]
  lightfast-dev-services redis-url [--json]
  lightfast-dev-services redis-up [--json]
  lightfast-dev-services redis-ping [--json]

Options:
  --app-name <name>     Runtime base app name for identity
  --config <path>       Path to related-projects.json. Default: walk upward from cwd
  --postgres-table <name>
                        Doctor check for an expected Postgres table
  --mfe-app <name>      Resolve a Portless MFE app URL through @lightfastai/related-projects
  --app-url <name=url>  Explicit app URL to sync into the Inngest Dev Server
  --serve-path <path>   Inngest serve route path. Default: /api/inngest
  --no-inngest-sync     Run the wrapped command without Inngest endpoint sync
  --json                Print JSON output where supported
`);
}
