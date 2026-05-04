import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { resolveDevPostgresConfig } from "@lightfastai/dev-services";

const [command, ...args] = process.argv.slice(2);

if (!command) {
	console.error("Usage: with-dev-postgres.mjs <command> [...args]");
	process.exit(1);
}

const config = resolveDevPostgresConfig({
	baseName: "mfe_sandbox",
	cwd: resolveWorkspaceRoot(),
});

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

function resolveWorkspaceRoot(startDir = process.cwd()) {
	let dir = path.resolve(startDir);

	for (;;) {
		if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
			return dir;
		}

		const parent = path.dirname(dir);
		if (parent === dir) {
			throw new Error(`Unable to find workspace root from ${startDir}`);
		}
		dir = parent;
	}
}
