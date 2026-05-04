import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
	assertLocalDevPostgresUrl,
	buildInngestDevSyncTargets,
	isInngestDevSyncEnabled,
	redactPostgresUrl,
	redactRedisRestUrl,
	resolveDevPostgresConfig,
	resolveDevPostgresDatabaseName,
	resolveDevRedisConfig,
	resolveDevRedisKeyPrefix,
	runDevServicesDoctor,
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

test("dev Postgres database names use Lightfast dev project identity and root hash", () => {
	const fixture = createProjectFixture("mfe");
	const databaseName = resolveDevPostgresDatabaseName({
		cwd: fixture.nested,
		env: {},
		detectWorktreePrefix: () => "feature/db-worktrees",
	});

	assert.match(databaseName, /^mfe_feature_db_worktrees_[a-f0-9]{8}$/);
	assert.equal(
		resolveDevPostgresDatabaseName({
			cwd: fixture.root,
			env: {},
			detectWorktreePrefix: () => "feature/db-worktrees",
		}),
		databaseName,
	);
	assert.equal(
		resolveDevPostgresDatabaseName({
			cwd: fixture.nested,
			env: { LIGHTFAST_DEV_DATABASE_NAME: "custom_db" },
		}),
		"custom_db",
	);
});

test("dev Postgres config derives a local URL and honors DATABASE_URL", () => {
	const fixture = createProjectFixture("mfe");
	const derived = resolveDevPostgresConfig({
		cwd: fixture.nested,
		env: { LIGHTFAST_DEV_POSTGRES_PORT: "5544" },
		detectWorktreePrefix: () => undefined,
	});

	assert.equal(derived.source, "derived");
	assert.equal(derived.port, 5544);
	assert.match(derived.databaseUrl, /^postgresql:\/\/postgres:postgres@127\.0\.0\.1:5544\/mfe_main_[a-f0-9]{8}$/);

	const fromEnv = resolveDevPostgresConfig({
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

test("dev Postgres config requires lightfast.dev.json for derived names", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "dev-services-no-config-"));
	assert.throws(
		() => resolveDevPostgresConfig({ cwd: root, env: {} }),
		/Could not find lightfast\.dev\.json/,
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

test("dev Redis key prefixes use Lightfast dev project identity and root hash", () => {
	const fixture = createProjectFixture("mfe");
	const keyPrefix = resolveDevRedisKeyPrefix({
		cwd: fixture.nested,
		env: {},
		detectWorktreePrefix: () => "feature/redis-worktrees",
	});

	assert.match(keyPrefix, /^mfe:feature-redis-worktrees:[a-f0-9]{8}$/);
	assert.equal(
		resolveDevRedisKeyPrefix({
			cwd: fixture.root,
			env: {},
			detectWorktreePrefix: () => "feature/redis-worktrees",
		}),
		keyPrefix,
	);
	assert.equal(
		resolveDevRedisKeyPrefix({
			cwd: fixture.nested,
			env: { LIGHTFAST_DEV_REDIS_KEY_PREFIX: "custom:redis_prefix" },
		}),
		"custom:redis-prefix",
	);
});

test("dev Redis config derives local REST config and honors env config", () => {
	const fixture = createProjectFixture("mfe");
	const derived = resolveDevRedisConfig({
		cwd: fixture.nested,
		env: { LIGHTFAST_DEV_REDIS_REST_PORT: "8078" },
		detectWorktreePrefix: () => undefined,
	});

	assert.equal(derived.source, "derived");
	assert.equal(derived.restUrl, "http://127.0.0.1:8078");
	assert.equal(derived.token, "lightfast-dev-redis-token");
	assert.match(derived.keyPrefix, /^mfe:main:[a-f0-9]{8}$/);

	const fromEnv = resolveDevRedisConfig({
		cwd: fixture.nested,
		env: {
			KV_REST_API_URL: "https://example.upstash.io/",
			KV_REST_API_TOKEN: "secret",
		},
	});

	assert.equal(fromEnv.source, "env");
	assert.equal(fromEnv.restUrl, "https://example.upstash.io");
	assert.equal(fromEnv.token, "secret");
	assert.equal(
		redactRedisRestUrl("https://example.upstash.io/info?_token=secret"),
		"https://example.upstash.io/info?_token=****",
	);
});

test("dev Redis config requires URL and token together", () => {
	const fixture = createProjectFixture("mfe");
	assert.throws(
		() => resolveDevRedisConfig({
			cwd: fixture.nested,
			env: { KV_REST_API_URL: "https://example.upstash.io" },
		}),
		/both URL and token/,
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
					if (typeof api.resolveDevRedisConfig !== "function") throw new Error("missing Redis config API");
					if (typeof api.runDevServicesDoctor !== "function") throw new Error("missing doctor API");
					if (typeof api.runDevServicesSetup !== "function") throw new Error("missing setup API");
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

test("runDevServicesDoctor reports missing lightfast dev config", async () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "dev-services-doctor-no-config-"));
	const report = await runDevServicesDoctor({
		cwd: root,
		env: {
			...process.env,
			DATABASE_URL: "",
			LIGHTFAST_DEV_DATABASE_NAME: "",
			KV_REST_API_URL: "",
			KV_REST_API_TOKEN: "",
			LIGHTFAST_DEV_REDIS_KEY_PREFIX: "",
			UPSTASH_REDIS_REST_URL: "",
			UPSTASH_REDIS_REST_TOKEN: "",
		},
	});

	assert.equal(report.status, "fail");
	assert.equal(report.project, null);
	assert.match(report.failures.join("\n"), /Could not find lightfast\.dev\.json/);
});

test("runDevServicesDoctor includes requested Postgres table check", async () => {
	const fixture = createProjectFixture("mfe");
	const report = await runDevServicesDoctor({
		cwd: fixture.nested,
		postgresTable: "example_probe_events",
		env: {
			...process.env,
			DATABASE_URL: "",
			LIGHTFAST_DEV_DATABASE_NAME: "",
			KV_REST_API_URL: "",
			KV_REST_API_TOKEN: "",
			LIGHTFAST_DEV_REDIS_KEY_PREFIX: "",
			UPSTASH_REDIS_REST_URL: "",
			UPSTASH_REDIS_REST_TOKEN: "",
		},
	});

	assert.equal(
		report.postgres?.checks.some((check) => check.name === "postgres-table:example_probe_events"),
		true,
	);
});

function createProjectFixture(name: string): { root: string; nested: string } {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "dev-services-project-"));
	const nested = path.join(root, "example", "apps", "app");
	fs.mkdirSync(nested, { recursive: true });
	fs.writeFileSync(
		path.join(root, "lightfast.dev.json"),
		JSON.stringify({ portless: { name } }),
	);
	return { root, nested };
}

async function waitFor(predicate: () => boolean): Promise<void> {
	const startedAt = Date.now();
	while (!predicate()) {
		if (Date.now() - startedAt > 500) {
			throw new Error("Timed out waiting for condition.");
		}
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}
