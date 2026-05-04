import {
	type DevPostgresConfig,
	resolveDevPostgresConfig,
} from "@lightfastai/dev-services";
import { createDrizzlePostgresClient } from "@example/vendor-db";
import * as schema from "./schema";
import { resolveExampleWorkspaceRoot } from "./workspace";

function createDb() {
	const config = resolveDevPostgresConfig({
		baseName: "mfe_sandbox",
		cwd: resolveExampleWorkspaceRoot(),
	});
	const { client, db } = createDrizzlePostgresClient({
		databaseUrl: config.databaseUrl,
		postgresOptions: {
			connect_timeout: 2,
			idle_timeout: 1,
			max: 1,
		},
		schema,
	});

	return { client, config, db };
}

type ExampleDb = ReturnType<typeof createDb>;

declare global {
	var __mfeSandboxExampleDb: ExampleDb | undefined;
}

export function getDb(): ExampleDb {
	globalThis.__mfeSandboxExampleDb ??= createDb();
	return globalThis.__mfeSandboxExampleDb;
}

export type ExampleDbConfig = DevPostgresConfig;
