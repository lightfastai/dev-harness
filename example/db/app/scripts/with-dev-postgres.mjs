import { spawnSync } from "node:child_process";
import { resolveDevPostgresConfig } from "@lightfastai/dev-services";

const [command, ...args] = process.argv.slice(2);

if (!command) {
	console.error("Usage: with-dev-postgres.mjs <command> [...args]");
	process.exit(1);
}

const config = resolveDevPostgresConfig();

const result = spawnSync(command, args, {
	env: {
		...process.env,
		DATABASE_URL: config.databaseUrl,
	},
	stdio: "inherit",
});

if (result.error) {
	console.error(result.error.message);
	process.exit(1);
}

process.exit(result.status ?? 1);
