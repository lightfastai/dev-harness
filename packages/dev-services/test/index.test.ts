import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
	assertLocalDevPostgresUrl,
	buildInngestDevSyncTargets,
	isInngestDevSyncEnabled,
	redactPostgresUrl,
	resolveDevPostgresConfig,
	resolveDevPostgresDatabaseName,
	startInngestDevSync,
	syncInngestDevTarget,
} from "../src/public.js";

test("Inngest dev sync targets use selected local app serve URLs", () => {
	const result = {
		appUrls: {
			"lightfast-app": "http://app.fix-ui.mfe.localhost:1355/",
			"lightfast-www": "http://www.fix-ui.mfe.localhost:1355/docs",
		},
		localAppNames: ["lightfast-app", "lightfast-www"],
	};

	assert.deepEqual(
		buildInngestDevSyncTargets({
			result,
			localApps: ["lightfast-www", "missing"],
		}),
		[{
			appName: "lightfast-www",
			url: "http://www.fix-ui.mfe.localhost:1355/api/inngest",
		}],
	);
	assert.deepEqual(
		buildInngestDevSyncTargets({
			result,
			servePath: "/custom/inngest",
		}),
		[
			{
				appName: "lightfast-app",
				url: "http://app.fix-ui.mfe.localhost:1355/custom/inngest",
			},
			{
				appName: "lightfast-www",
				url: "http://www.fix-ui.mfe.localhost:1355/custom/inngest",
			},
		],
	);
});

test("Inngest dev sync classifies registration responses", async () => {
	const target = {
		appName: "lightfast-app",
		url: "http://app.mfe.localhost:1355/api/inngest",
	};
	const calls: Array<{ input: string | URL; method?: string }> = [];

	const synced = await syncInngestDevTarget(target, {
		fetchImpl: async (input, init) => {
			calls.push({ input, method: init?.method });
			return { status: 200 };
		},
	});

	assert.deepEqual(synced, { status: "synced", statusCode: 200 });
	assert.equal(calls[0]?.input, target.url);
	assert.equal(calls[0]?.method, "PUT");
	assert.deepEqual(
		await syncInngestDevTarget(target, {
			fetchImpl: async () => ({ status: 404 }),
		}),
		{ status: "skipped", statusCode: 404, reason: "HTTP 404" },
	);
	assert.deepEqual(
		await syncInngestDevTarget(target, {
			fetchImpl: async () => ({ status: 500 }),
		}),
		{ status: "retry", statusCode: 500, reason: "HTTP 500" },
	);
	assert.equal(isInngestDevSyncEnabled({}), true);
	assert.equal(isInngestDevSyncEnabled({ PORTLESS_MFE_INNGEST_SYNC: "0" }), false);
	assert.equal(isInngestDevSyncEnabled({ PORTLESS_MFE_INNGEST_SYNC: "off" }), false);
});

test("Inngest dev sync retries early route misses during startup grace", async () => {
	const logs: string[] = [];
	let calls = 0;
	const runtime = startInngestDevSync({
		targets: [{
			appName: "lightfast-app",
			url: "http://app.mfe.localhost:1355/api/inngest",
		}],
		fetchImpl: async () => ({ status: ++calls === 1 ? 404 : 200 }),
		initialDelayMs: 0,
		intervalMs: 1,
		skipAfterMs: 100,
		logger: {
			log: (message) => logs.push(message),
			warn: (message) => logs.push(message),
		},
	});

	try {
		await waitFor(() => logs.some((message) => message.startsWith("Inngest synced ")));
	} finally {
		runtime.stop();
	}

	assert.equal(calls, 2);
	assert.deepEqual(logs, [
		"Inngest synced lightfast-app: http://app.mfe.localhost:1355/api/inngest",
	]);
});

test("Inngest dev sync skips persistent missing routes after grace", async () => {
	const logs: string[] = [];
	const runtime = startInngestDevSync({
		targets: [{
			appName: "missing",
			url: "http://missing.mfe.localhost:1355/api/inngest",
		}],
		fetchImpl: async () => ({ status: 404 }),
		initialDelayMs: 0,
		intervalMs: 1,
		skipAfterMs: 1,
		logger: {
			log: (message) => logs.push(message),
			warn: (message) => logs.push(message),
		},
	});

	try {
		await waitFor(() => logs.some((message) => message.startsWith("Inngest sync skipped ")));
	} finally {
		runtime.stop();
	}

	assert.deepEqual(logs, ["Inngest sync skipped missing: HTTP 404"]);
});

test("dev Postgres database names include worktree identity and cwd hash", () => {
	const databaseName = resolveDevPostgresDatabaseName({
		baseName: "mfe-sandbox",
		cwd: "/tmp/example-worktree",
		env: {},
		detectWorktreePrefix: () => "feature/db-worktrees",
	});

	assert.match(databaseName, /^mfe_sandbox_feature_db_worktrees_[a-f0-9]{8}$/);
	assert.equal(
		resolveDevPostgresDatabaseName({
			baseName: "mfe-sandbox",
			cwd: "/tmp/example-worktree",
			env: { LIGHTFAST_DEV_DATABASE_NAME: "custom_db" },
		}),
		"custom_db",
	);
});

test("dev Postgres config derives a local URL and honors DATABASE_URL", () => {
	const derived = resolveDevPostgresConfig({
		baseName: "mfe-sandbox",
		cwd: "/tmp/example-worktree",
		env: { LIGHTFAST_DEV_POSTGRES_PORT: "5544" },
		detectWorktreePrefix: () => undefined,
	});

	assert.equal(derived.source, "derived");
	assert.equal(derived.port, 5544);
	assert.match(derived.databaseUrl, /^postgresql:\/\/postgres:postgres@127\.0\.0\.1:5544\/mfe_sandbox_main_[a-f0-9]{8}$/);

	const fromEnv = resolveDevPostgresConfig({
		baseName: "mfe-sandbox",
		env: {
			DATABASE_URL: "postgresql://postgres:secret@localhost:5555/worktree_db",
		},
	});

	assert.equal(fromEnv.source, "env");
	assert.equal(fromEnv.databaseName, "worktree_db");
	assert.equal(fromEnv.port, 5555);
	assert.equal(fromEnv.password, "secret");
	assert.equal(
		redactPostgresUrl(fromEnv.databaseUrl),
		"postgresql://postgres:****@localhost:5555/worktree_db",
	);
});

test("dev Postgres URL validation rejects remote and reserved databases", () => {
	assert.equal(
		assertLocalDevPostgresUrl("postgresql://postgres:postgres@127.0.0.1:5432/worktree_db").databaseName,
		"worktree_db",
	);
	assert.throws(
		() => assertLocalDevPostgresUrl("postgresql://postgres:postgres@example.com:5432/worktree_db"),
		/localhost/,
	);
	assert.throws(
		() => assertLocalDevPostgresUrl("postgresql://postgres:postgres@127.0.0.1:5432/postgres"),
		/reserved/,
	);
});

test("package export map supports intended ESM imports", () => {
	const result = spawnSync(
		process.execPath,
		[
			"--input-type=module",
			"--eval",
			`
				const api = await import("@lightfastai/dev-services");
				if (typeof api.startInngestDevSync !== "function") throw new Error("missing Inngest sync API");
				if (typeof api.resolveDevPostgresConfig !== "function") throw new Error("missing Postgres config API");
				if ("resolveWorktreeRuntimeName" in api) throw new Error("worktree API should live in @lightfastai/dev-core");
			`,
		],
		{
			cwd: process.cwd(),
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		},
	);

	assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("CLI identity prints worktree-scoped JSON", () => {
	const result = spawnSync(
		process.execPath,
		[
			"dist/cli.js",
			"identity",
			"--app-name",
			"lightfast-app",
			"--json",
		],
		{
			cwd: process.cwd(),
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		},
	);

	assert.equal(result.status, 0, result.stderr || result.stdout);
	const identity = JSON.parse(result.stdout) as {
		name: string;
		baseName: string;
		worktreePrefix?: string;
	};
	assert.equal(identity.baseName, "lightfast-app");
	assert.equal(
		identity.worktreePrefix
			? identity.name.startsWith("lightfast-app-")
			: identity.name,
		identity.worktreePrefix ? true : "lightfast-app",
	);
});

test("CLI postgres-url prints derived JSON config", () => {
	const result = spawnSync(
		process.execPath,
		[
			"dist/cli.js",
			"postgres-url",
			"--base-name",
			"mfe-sandbox",
			"--json",
		],
		{
			cwd: process.cwd(),
			encoding: "utf8",
			env: {
				...process.env,
				LIGHTFAST_DEV_DATABASE_NAME: "mfe_sandbox_cli",
				LIGHTFAST_DEV_POSTGRES_PORT: "5544",
				DATABASE_URL: "",
			},
			stdio: ["ignore", "pipe", "pipe"],
		},
	);

	assert.equal(result.status, 0, result.stderr || result.stdout);
	const config = JSON.parse(result.stdout) as {
		databaseName: string;
		databaseUrl: string;
		redactedDatabaseUrl: string;
		port: number;
	};
	assert.equal(config.databaseName, "mfe_sandbox_cli");
	assert.equal(config.port, 5544);
	assert.equal(config.databaseUrl, "postgresql://postgres:postgres@127.0.0.1:5544/mfe_sandbox_cli");
	assert.equal(config.redactedDatabaseUrl, "postgresql://postgres:****@127.0.0.1:5544/mfe_sandbox_cli");
});

async function waitFor(predicate: () => boolean): Promise<void> {
	const startedAt = Date.now();
	while (!predicate()) {
		if (Date.now() - startedAt > 500) {
			throw new Error("Timed out waiting for condition.");
		}
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}
