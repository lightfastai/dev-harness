import { existsSync } from "node:fs";
import path from "node:path";
import {
	resolveDevPostgresConfig,
	type DevPostgresConfig,
} from "@lightfastai/dev-services";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

function createAppDb() {
	const config = resolveDevPostgresConfig({
		baseName: "mfe_sandbox",
		cwd: resolveAppDbCwd(),
	});
	const client = postgres(config.databaseUrl, {
		connect_timeout: 2,
		idle_timeout: 1,
		max: 1,
	});
	const db = drizzle({ client });

	return { client, config, db };
}

type AppDb = ReturnType<typeof createAppDb>;

declare global {
	var __mfeSandboxAppDb: AppDb | undefined;
}

export function resolveAppDbCwd(startDir = process.cwd()): string {
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

export function getAppDb(): AppDb {
	globalThis.__mfeSandboxAppDb ??= createAppDb();
	return globalThis.__mfeSandboxAppDb;
}

export type AppDbConfig = DevPostgresConfig;
