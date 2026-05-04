import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("CLI help lists primary command groups", () => {
	const result = runCli(["--help"]);

	assert.equal(result.status, 0, result.stderr || result.stdout);
	assert.match(result.stdout, /lightfast-dev setup/);
	assert.match(result.stdout, /lightfast-dev proxy dev/);
	assert.match(result.stdout, /lightfast-dev postgres url/);
});

test("CLI identity prints worktree-scoped JSON", () => {
	const result = runCli(["identity", "--app-name", "lightfast-app", "--json"]);

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

test("CLI postgres url prints derived JSON config", () => {
	const fixture = createProjectFixture("mfe");
	const result = runCli(["postgres", "url", "--json"], {
		cwd: fixture.nested,
		env: {
			...process.env,
			LIGHTFAST_DEV_DATABASE_NAME: "",
			LIGHTFAST_DEV_POSTGRES_PORT: "5544",
			DATABASE_URL: "",
		},
	});

	assert.equal(result.status, 0, result.stderr || result.stdout);
	const config = JSON.parse(result.stdout) as {
		databaseName: string;
		databaseUrl: string;
		redactedDatabaseUrl: string;
		port: number;
	};
	assert.match(config.databaseName, /^mfe_main_[a-f0-9]{8}$/);
	assert.equal(config.port, 5544);
	assert.equal(config.databaseUrl, `postgresql://postgres:postgres@127.0.0.1:5544/${config.databaseName}`);
	assert.equal(config.redactedDatabaseUrl, `postgresql://postgres:****@127.0.0.1:5544/${config.databaseName}`);
});

test("package export map supports intended ESM import", () => {
	const result = spawnSync(
		process.execPath,
		[
			"--input-type=module",
			"--eval",
			`
				const api = await import("@lightfastai/dev-cli");
				if (typeof api.main !== "function") throw new Error("missing main API");
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

function createProjectFixture(name: string): { root: string; nested: string } {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "dev-cli-project-"));
	const nested = path.join(root, "example", "apps", "app");
	fs.mkdirSync(nested, { recursive: true });
	fs.writeFileSync(
		path.join(root, "lightfast.dev.json"),
		JSON.stringify({ portless: { name } }),
	);
	return { root, nested };
}

function runCli(
	args: string[],
	options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
) {
	return spawnSync(
		process.execPath,
		[path.resolve("dist/cli.js"), ...args],
		{
			cwd: options.cwd ?? process.cwd(),
			encoding: "utf8",
			env: options.env ?? process.env,
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
}
