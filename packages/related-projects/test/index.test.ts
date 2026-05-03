import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
	addTurboDevEnvMode,
	branchToPrefix,
	choosePort,
	createVercelMicrofrontendsDevEnv,
	createVercelMicrofrontendsDevConfig,
	getPortlessMfeDevOrigins,
	inferLocalAppNames,
	loadPortlessMfeConfig,
	resolvePortlessApplicationUrl,
	resolvePortlessMfeRuntime,
	resolvePortlessUrl,
	resolveRuntimeIdentity,
	resolveTargetUrl,
	selectLocalAppNames,
} from "../src/index.js";
import { withPortlessMfeDev } from "../src/next.js";
import { resolveRelatedProjectUrl } from "../src/related-projects.js";
import type { MicrofrontendsSourceConfig } from "../src/index.js";

const require = createRequire(import.meta.url);

test("loadPortlessMfeConfig reads JSON config and applies fixed defaults", async () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "portless-mfe-config-"));
	writeJson(path.join(root, "related-projects.json"), {
		portless: {
			name: "mfe",
			port: 1355,
			https: false,
		},
		microfrontends: {
			config: "apps/app/microfrontends.json",
		},
	});

	const config = await loadPortlessMfeConfig({ cwd: root });

	assert.equal(config.configPath, path.join(root, "related-projects.json"));
	assert.equal(config.portless.name, "mfe");
	assert.equal(config.microfrontends.config, "apps/app/microfrontends.json");
	assert.equal(config.microfrontends.proxyPortRange.max, 9999);
	assert.equal("target" in config, false);
});

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

test("resolveTargetUrl does not read a target path from package config", () => {
	const targetUrl = resolveTargetUrl({
		name: "mfe",
		config: {
			portless: {
				name: "mfe",
				port: 1355,
				https: false,
			},
			target: {
				path: "/sign-in",
			},
		},
		env: {
			PORTLESS_HTTPS: "0",
			PORTLESS_PORT: "1355",
		},
		getPortlessUrl: () => undefined,
		detectWorktreePrefix: () => undefined,
	});

	assert.equal(targetUrl, "http://mfe.localhost:1355/");
});

test("resolvePortlessUrl only reuses PORTLESS_URL for the matching service", () => {
	const options = {
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
			PORTLESS_URL: "http://fix-ui.mfe.localhost:1355",
		},
		getPortlessUrl: () => undefined,
		detectWorktreePrefix: () => "fix-ui",
	};

	assert.equal(resolvePortlessUrl({ ...options, name: "mfe" }), "http://fix-ui.mfe.localhost:1355/");
	assert.equal(resolvePortlessUrl({ ...options, name: "app.mfe" }), "http://fix-ui.app.mfe.localhost:1355/");
});

test("resolvePortlessMfeRuntime loads config for direct API consumers", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "portless-mfe-runtime-"));
	writeJson(path.join(root, "related-projects.json"), {
		portless: {
			name: "lightfast",
			port: 1355,
			https: false,
		},
		microfrontends: {
			config: "apps/app/microfrontends.json",
		},
	});

	const identity = resolvePortlessMfeRuntime({
		cwd: root,
		path: "/sign-in",
		env: {
			PORTLESS_HTTPS: "0",
			PORTLESS_PORT: "1355",
		},
		getPortlessUrl: () => undefined,
		detectWorktreePrefix: () => "fix-ui",
	});

	assert.equal(
		identity.targetUrl,
		"http://fix-ui.lightfast.localhost:1355/sign-in",
	);
	assert.equal(identity.name, "lightfast-desktop-fix-ui");
});

test("withPortlessMfeDev adds config-derived local origins to Next config", () => {
	const root = createFixtureWorkspace();
	writeJson(path.join(root, "related-projects.json"), {
		portless: {
			name: "mfe",
			tld: "localhost",
		},
		microfrontends: {
			config: "apps/app/microfrontends.json",
		},
	});

	assert.deepEqual(getPortlessMfeDevOrigins({ cwd: root }), [
		"mfe.localhost",
		"*.mfe.localhost",
		"app.mfe.localhost",
		"*.app.mfe.localhost",
		"platform.mfe.localhost",
		"*.platform.mfe.localhost",
		"www.mfe.localhost",
		"*.www.mfe.localhost",
	]);

	const wrapped = withPortlessMfeDev(
		{ allowedDevOrigins: ["custom.localhost"] },
		{ cwd: root },
	);
	assert.deepEqual(wrapped.allowedDevOrigins, [
		"custom.localhost",
		"mfe.localhost",
		"*.mfe.localhost",
		"app.mfe.localhost",
		"*.app.mfe.localhost",
		"platform.mfe.localhost",
		"*.platform.mfe.localhost",
		"www.mfe.localhost",
		"*.www.mfe.localhost",
	]);

	assert.deepEqual(
		withPortlessMfeDev(
			{ reactStrictMode: true },
			{ cwd: path.join(os.tmpdir(), "missing-portless-mfe") },
		),
		{ reactStrictMode: true },
	);
});

test("CommonJS Next wrapper exports the same helpers", () => {
	const cjsNext = require("../src/next.cjs") as typeof import("../src/next.js");

	assert.equal(typeof cjsNext.withPortlessMfeDev, "function");
	assert.equal(typeof cjsNext.getPortlessMfeDevOrigins, "function");
	assert.deepEqual(
		cjsNext.withPortlessMfeDev(
			{ allowedDevOrigins: ["custom.localhost"] },
			{ origins: ["mfe.localhost"] },
		).allowedDevOrigins,
		["custom.localhost", "mfe.localhost"],
	);
});

test("choosePort scans upward from deterministic candidate when a port is busy", async () => {
	const checked: number[] = [];
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
			microfrontends: {
				config: "apps/app/microfrontends.json",
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
		detectWorktreePrefix: () => "feature",
	});

	assert.equal(result.host, "feature.mfe.localhost");
	assert.equal(result.localProxyPort, 7777);
	assert.equal(
		result.generatedConfigPath,
		path.join(root, "apps/app/microfrontends.local.json"),
	);
	assert.equal(result.appDirs.app, path.join(root, "apps/app"));
	assert.equal(result.appDirs.platform, path.join(root, "apps/platform"));
	assert.equal(result.appDirs.www, path.join(root, "apps/www"));
	assert.equal(result.generatedConfig.options?.localProxyPort, 7777);
	assert.deepEqual(result.appUrls, {
		app: "http://feature.app.mfe.localhost:1355/",
		platform: "http://feature.platform.mfe.localhost:1355/",
		www: "http://feature.www.mfe.localhost:1355/",
	});
	assert.deepEqual(
		Object.keys(result.appBridgePorts),
		["app", "platform", "www"],
	);
	const generatedConfig = result.generatedConfig as MicrofrontendsSourceConfig & {
		applications: {
			platform: {
				development: {
					local: number;
				};
			};
		};
	};
	assert.equal(typeof generatedConfig.applications.platform.development.local, "number");
	assert.equal(
		generatedConfig.applications.platform.development.local,
		result.appBridgePorts.platform,
	);
	assert.notEqual(result.appBridgePorts.platform, 7777);
	for (const port of Object.values(result.appBridgePorts)) {
		assert.equal(port >= 5100 && port <= 8999, true);
	}
});

test("selectLocalAppNames defaults to all apps and validates requested local apps", () => {
	const applications = {
		app: {},
		platform: {},
		www: {},
	};

	assert.deepEqual(selectLocalAppNames(applications), ["app", "platform", "www"]);
	assert.deepEqual(selectLocalAppNames(applications, ["www", "app", "www"]), ["www", "app"]);
	assert.throws(
		() => selectLocalAppNames(applications, ["missing"]),
		/Unknown local app\(s\): missing/,
	);
});

test("selectLocalAppNames accepts Vercel app names, package names, and short package names", () => {
	const applications = {
		"lightfast-app": {
			packageName: "@lightfast/app",
		},
		"lightfast-www": {
			packageName: "@lightfast/www",
		},
	};

	assert.deepEqual(
		selectLocalAppNames(applications, ["@lightfast/www", "app"]),
		["lightfast-www", "lightfast-app"],
	);
});

test("resolvePortlessApplicationUrl supports Lightfast-style package names and overrides", () => {
	const root = createLightfastFixtureWorkspace();

	assert.equal(
		resolvePortlessApplicationUrl({
			app: "@lightfast/app",
			cwd: root,
			env: {
				PORTLESS_HTTPS: "0",
				PORTLESS_PORT: "1355",
				PORTLESS_URL: "http://fix-ui.lightfast.localhost:1355",
			},
			getPortlessUrl: () => undefined,
			detectWorktreePrefix: () => "fix-ui",
		}),
		"http://fix-ui.app.lightfast.localhost:1355/",
	);
	assert.equal(
		resolvePortlessApplicationUrl({
			app: "lightfast-www",
			cwd: root,
			env: {
				PORTLESS_HTTPS: "0",
				PORTLESS_PORT: "1355",
			},
			getPortlessUrl: () => undefined,
			detectWorktreePrefix: () => undefined,
		}),
		"http://docs.lightfast.localhost:1355/",
	);
});

test("inferLocalAppNames uses command filters and falls back without --local-app", () => {
	const applications = {
		"lightfast-app": {
			packageName: "@lightfast/app",
		},
		"lightfast-www": {
			packageName: "@lightfast/www",
		},
	};

	assert.deepEqual(
		inferLocalAppNames({
			applications,
			commandArgs: [
				"turbo",
				"run",
				"dev",
				"-F",
				"@lightfast/www",
				"--filter=@lightfast/app",
			],
		}),
		["lightfast-www", "lightfast-app"],
	);
	assert.deepEqual(inferLocalAppNames({ applications }), [
		"lightfast-app",
		"lightfast-www",
	]);
});

test("portless-mfe turbo helpers inject dev env and Turbo loose env mode", () => {
	const result = {
		localProxyPort: 9123,
		generatedConfigPath: "/repo/apps/app/microfrontends.local.json",
		runtimeConfigFilename: "microfrontends.local.json",
	};
	const env = createVercelMicrofrontendsDevEnv({
		result,
		localApps: ["lightfast-app", "lightfast-www"],
		env: { EXISTING: "1" },
	});

	assert.equal(env.EXISTING, "1");
	assert.equal(env.MFE_LOCAL_PROXY_PORT, "9123");
	assert.equal(env.MFE_DISABLE_LOCAL_PROXY_REWRITE, "1");
	assert.equal(env.PORTLESS_MFE_LOCAL_APPS, "lightfast-app,lightfast-www");
	assert.equal(env.VC_MICROFRONTENDS_CONFIG, "/repo/apps/app/microfrontends.local.json");
	assert.equal(env.VC_MICROFRONTENDS_CONFIG_FILE_NAME, "microfrontends.local.json");
	assert.deepEqual(
		addTurboDevEnvMode(["turbo", "run", "dev", "--filter=app"]),
		["turbo", "run", "--env-mode=loose", "dev", "--filter=app"],
	);
	assert.deepEqual(
		addTurboDevEnvMode(["turbo", "run", "--env-mode=strict", "dev"]),
		["turbo", "run", "--env-mode=strict", "dev"],
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

test("resolveRelatedProjectUrl keeps Vercel related-project fallback with local Portless URLs", () => {
	const root = createLightfastFixtureWorkspace();
	const localUrl = resolveRelatedProjectUrl({
		key: "platform",
		cwd: root,
		env: {
			PORTLESS_HTTPS: "0",
			PORTLESS_PORT: "1355",
		},
		getPortlessUrl: () => undefined,
		detectWorktreePrefix: () => "fix-ui",
	});
	const productionFallback = resolveRelatedProjectUrl({
		key: "platform",
		cwd: root,
		env: {
			VERCEL: "1",
			VERCEL_ENV: "production",
			PORTLESS_HTTPS: "0",
			PORTLESS_PORT: "1355",
		},
		getPortlessUrl: () => undefined,
		detectWorktreePrefix: () => "fix-ui",
	});

	assert.equal(localUrl, "http://fix-ui.platform.lightfast.localhost:1355/");
	assert.equal(productionFallback, "https://lightfast-platform.vercel.app");
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

function createLightfastFixtureWorkspace() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "portless-lightfast-"));
	fs.writeFileSync(
		path.join(root, "pnpm-workspace.yaml"),
		'packages:\n  - "apps/*"\n',
	);
	writeJson(path.join(root, "related-projects.json"), {
		portless: {
			name: "lightfast",
			port: 1355,
			https: false,
		},
		microfrontends: {
			config: "apps/app/microfrontends.json",
			apps: {
				"lightfast-www": {
					portlessName: "docs.lightfast",
				},
			},
		},
		relatedProjects: {
			platform: {
				projectName: "lightfast-platform",
				fallbackHost: "https://lightfast-platform.vercel.app",
			},
		},
	});
	writeJson(path.join(root, "apps/app/package.json"), { name: "@lightfast/app" });
	writeJson(path.join(root, "apps/www/package.json"), { name: "@lightfast/www" });
	writeJson(path.join(root, "apps/app/microfrontends.json"), {
		applications: {
			"lightfast-app": {
				packageName: "@lightfast/app",
				development: {
					fallback: "lightfast-app.vercel.app",
				},
			},
			"lightfast-www": {
				packageName: "@lightfast/www",
				development: {
					fallback: "lightfast-www.vercel.app",
				},
			},
		},
	});
	return root;
}

function writeJson(filePath: string, value: unknown) {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
