import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
	branchToPrefix,
	choosePort,
	createVercelMicrofrontendsDevConfig,
	resolveRuntimeIdentity,
	resolveTargetUrl,
} from "../src/index.js";

test("resolveTargetUrl derives worktree host without shelling out", () => {
	const targetUrl = resolveTargetUrl({
		name: "mfe",
		path: "/sign-in",
		config: {
			portless: {
				name: "mfe",
				port: 1355,
				https: false,
			},
		},
		env: {
			PORTLESS_HTTPS: "0",
			PORTLESS_PORT: "1355",
		},
		getPortlessUrl: () => undefined,
		detectWorktreePrefix: () => "fix-ui",
	});

	assert.equal(targetUrl, "http://fix-ui.mfe.localhost:1355/sign-in");
	assert.equal(branchToPrefix("feature/platform-shell"), "platform-shell");
	assert.equal(branchToPrefix("main"), undefined);
});

test("choosePort scans upward from deterministic candidate when a port is busy", async () => {
	const checked = [];
	const port = await choosePort("scan-seed", {
		min: 5100,
		max: 5103,
		portAvailable: async (candidate) => {
			checked.push(candidate);
			return checked.length > 1;
		},
	});

	assert.equal(checked.length, 2);
	assert.equal(port, checked[1]);
});

test("createVercelMicrofrontendsDevConfig infers arbitrary app directories", async () => {
	const root = createFixtureWorkspace();
	const result = await createVercelMicrofrontendsDevConfig({
		cwd: root,
		config: {
			root,
			portless: {
				name: "mfe",
				port: 1355,
				https: false,
			},
			vercelMicrofrontends: {
				sourceConfig: "apps/app/microfrontends.json",
				generatedConfig: ".turbo/microfrontends.local.json",
				appPortRange: { min: 5100, max: 5110 },
				proxyPortRange: { min: 9100, max: 9110 },
			},
		},
		env: {
			PORT: "7777",
			PORTLESS_URL: "http://feature.mfe.localhost:1355",
		},
		write: false,
		portAvailable: async () => true,
		getPortlessUrl: () => undefined,
	});

	assert.equal(result.host, "feature.mfe.localhost");
	assert.equal(result.localProxyPort, 7777);
	assert.equal(result.appDirs.app, path.join(root, "apps/app"));
	assert.equal(result.appDirs.platform, path.join(root, "apps/platform"));
	assert.equal(result.appDirs.www, path.join(root, "apps/www"));
	assert.equal(
		result.generatedConfig.options.localProxyPort,
		7777,
	);
	assert.equal(
		typeof result.generatedConfig.applications.platform.development.local,
		"number",
	);
});

test("resolveRuntimeIdentity is Electron-agnostic and suffixes linked worktrees", () => {
	const main = resolveRuntimeIdentity({
		name: "mfe",
		targetUrl: "http://mfe.localhost:1355/sign-in",
		appName: "mfe-desktop",
	});
	const linked = resolveRuntimeIdentity({
		name: "mfe",
		targetUrl: "http://fix-ui.mfe.localhost:1355/sign-in",
		appName: "mfe-desktop",
	});

	assert.equal(main.name, "mfe-desktop");
	assert.equal(linked.name, "mfe-desktop-fix-ui");
	assert.equal(linked.worktreePrefix, "fix-ui");
});

function createFixtureWorkspace() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "portless-mfe-"));
	fs.writeFileSync(
		path.join(root, "pnpm-workspace.yaml"),
		'packages:\n  - "apps/*"\n',
	);

	writeJson(path.join(root, "apps/app/package.json"), { name: "app" });
	writeJson(path.join(root, "apps/platform/package.json"), { name: "@repo/platform" });
	writeJson(path.join(root, "apps/www/package.json"), { name: "www" });
	writeJson(path.join(root, "apps/app/microfrontends.json"), {
		applications: {
			app: {
				development: {
					fallback: "app.localhost",
				},
			},
			platform: {
				packageName: "@repo/platform",
				development: {
					fallback: "platform.localhost",
				},
				routing: [
					{
						paths: ["/platform", "/platform/:path*"],
					},
				],
			},
			www: {
				development: {
					fallback: "www.localhost",
				},
				routing: [
					{
						paths: ["/docs", "/docs/:path*"],
					},
				],
			},
		},
	});

	return root;
}

function writeJson(filePath, value) {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
