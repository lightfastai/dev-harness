import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
	addTurboDevEnvMode,
	choosePort,
	createVercelMicrofrontendsDevEnv,
	createVercelMicrofrontendsDevConfig,
	generateMicrofrontendsPort,
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
import type {
	MicrofrontendsSourceConfig,
	VercelMicrofrontendsDevConfigResult,
} from "../src/index.js";

const require = createRequire(import.meta.url);

interface NextConfigLike {
	reactStrictMode?: boolean;
	allowedDevOrigins?: string[];
}

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
	assert.deepEqual(getPortlessMfeDevOrigins({ cwd: root, includePort: true }), [
		"mfe.localhost:1355",
		"*.mfe.localhost:1355",
		"app.mfe.localhost:1355",
		"*.app.mfe.localhost:1355",
		"platform.mfe.localhost:1355",
		"*.platform.mfe.localhost:1355",
		"www.mfe.localhost:1355",
		"*.www.mfe.localhost:1355",
	]);
	assert.deepEqual(getPortlessMfeDevOrigins({ cwd: root, includePort: "both" }), [
		"mfe.localhost",
		"*.mfe.localhost",
		"mfe.localhost:1355",
		"*.mfe.localhost:1355",
		"app.mfe.localhost",
		"*.app.mfe.localhost",
		"app.mfe.localhost:1355",
		"*.app.mfe.localhost:1355",
		"platform.mfe.localhost",
		"*.platform.mfe.localhost",
		"platform.mfe.localhost:1355",
		"*.platform.mfe.localhost:1355",
		"www.mfe.localhost",
		"*.www.mfe.localhost",
		"www.mfe.localhost:1355",
		"*.www.mfe.localhost:1355",
	]);
	assert.deepEqual(
		getPortlessMfeDevOrigins({
			cwd: root,
			env: { PORTLESS_PORT: "2468" },
			includePort: "both",
			includeWildcard: false,
		}),
		[
			"mfe.localhost",
			"mfe.localhost:2468",
			"app.mfe.localhost",
			"app.mfe.localhost:2468",
			"platform.mfe.localhost",
			"platform.mfe.localhost:2468",
			"www.mfe.localhost",
			"www.mfe.localhost:2468",
		],
	);

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

	const nextConfigLike: NextConfigLike = { reactStrictMode: true };
	const wrappedNextConfigLike: NextConfigLike = withPortlessMfeDev(
		nextConfigLike,
		{ origins: ["typed.localhost"] },
	);
	assert.deepEqual(wrappedNextConfigLike, {
		reactStrictMode: true,
		allowedDevOrigins: ["typed.localhost"],
	});
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

test("package export map supports intended ESM imports", () => {
	const result = runNode([
		"--input-type=module",
		"--eval",
		`
			const publicApi = await import("@lightfastai/related-projects");
			const nextApi = await import("@lightfastai/related-projects/next");
			const relatedProjectsApi = await import("@lightfastai/related-projects/related-projects");
			if (typeof publicApi.resolvePortlessMfeRuntime !== "function") throw new Error("missing public API");
			if (typeof nextApi.withPortlessMfeDev !== "function") throw new Error("missing next API");
			if (typeof relatedProjectsApi.resolveRelatedProjectUrl !== "function") throw new Error("missing related-projects API");
		`,
	]);

	assertNodeOk(result);
});

test("package export map supports CommonJS require for Next helpers", () => {
	const result = runNode([
		"--eval",
		`
			const nextApi = require("@lightfastai/related-projects/next");
			if (typeof nextApi.withPortlessMfeDev !== "function") throw new Error("missing next API");
		`,
	]);

	assertNodeOk(result);
});

test("package export map keeps related-projects unsupported for CommonJS require", () => {
	const result = runNode([
		"--eval",
		`
			try {
				require("@lightfastai/related-projects/related-projects");
				throw new Error("expected CommonJS require to fail");
			} catch (error) {
				if (error && error.code === "ERR_PACKAGE_PATH_NOT_EXPORTED") {
					process.exit(0);
				}
				throw error;
			}
		`,
	]);

	assertNodeOk(result);
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
		result.appPorts,
		expectedAppPorts(["app", "platform", "www"], "feature.mfe.localhost", "mfe.localhost"),
	);
	assert.equal("appBridgePorts" in result, false);
	const generatedConfig = result.generatedConfig as MicrofrontendsSourceConfig & {
		applications: {
			app: {
				development: {
					local: string;
				};
			};
			platform: {
				development: {
					local: string;
				};
			};
			www: {
				development: {
					local: string;
				};
				routing: Array<{ paths: string[] }>;
			};
		};
	};
	assert.equal(generatedConfig.applications.app.development.local, result.appLocalUrls.app);
	assert.equal(generatedConfig.applications.platform.development.local, result.appLocalUrls.platform);
	assert.equal(generatedConfig.applications.www.development.local, result.appLocalUrls.www);
	assertValidMicrofrontendsDevConfig(result.generatedConfig);
	assert.equal(
		generatedConfig.applications.www.routing[0].paths.includes("/vc-ap-4eae35/:path*"),
		true,
	);
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

test("createVercelMicrofrontendsDevConfig uses app-host local URLs for Lightfast hosts", async () => {
	const root = createLightfastFixtureWorkspace();
	const baseConfig = {
		root,
		portless: {
			name: "lightfast",
			port: 443,
			https: true,
		},
		microfrontends: {
			config: "apps/app/microfrontends.json",
		},
	};

	const main = await createVercelMicrofrontendsDevConfig({
		cwd: root,
		config: baseConfig,
		env: {},
		write: false,
		portAvailable: async () => true,
		getPortlessUrl: () => undefined,
		detectWorktreePrefix: () => undefined,
	});
	const worktree = await createVercelMicrofrontendsDevConfig({
		cwd: root,
		config: baseConfig,
		env: {},
		write: false,
		portAvailable: async () => true,
		getPortlessUrl: () => undefined,
		detectWorktreePrefix: () => "fix-ui",
	});
	const secondWorktree = await createVercelMicrofrontendsDevConfig({
		cwd: root,
		config: baseConfig,
		env: {},
		write: false,
		portAvailable: async () => true,
		getPortlessUrl: () => undefined,
		detectWorktreePrefix: () => "fix-clerk",
	});

	assert.equal(main.host, "lightfast.localhost");
	assert.equal(main.appUrls["lightfast-app"], "https://app.lightfast.localhost/");
	assert.equal(main.appPorts["lightfast-app"], generateMicrofrontendsPort("lightfast-app"));
	assert.equal(
		getGeneratedLocal(main, "lightfast-app"),
		`http://app.lightfast.localhost:${generateMicrofrontendsPort("lightfast-app")}`,
	);
	assert.equal("appBridgePorts" in main, false);
	assertValidMicrofrontendsDevConfig(main.generatedConfig);

	assert.equal(worktree.host, "fix-ui.lightfast.localhost");
	assert.equal(
		worktree.appUrls["lightfast-app"],
		"https://fix-ui.app.lightfast.localhost/",
	);
	assert.equal(
		worktree.appPorts["lightfast-app"],
		expectedAppPorts(["lightfast-app", "lightfast-www"], "fix-ui.lightfast.localhost", "lightfast.localhost")[
			"lightfast-app"
		],
	);
	assert.notEqual(worktree.appPorts["lightfast-app"], main.appPorts["lightfast-app"]);
	assert.equal(
		getGeneratedLocal(worktree, "lightfast-app"),
		`http://fix-ui.app.lightfast.localhost:${worktree.appPorts["lightfast-app"]}`,
	);
	assert.equal("appBridgePorts" in worktree, false);
	assertValidMicrofrontendsDevConfig(worktree.generatedConfig);

	assert.equal(secondWorktree.host, "fix-clerk.lightfast.localhost");
	assert.equal(
		secondWorktree.appUrls["lightfast-app"],
		"https://fix-clerk.app.lightfast.localhost/",
	);
	assert.equal(
		getGeneratedLocal(secondWorktree, "lightfast-app"),
		`http://fix-clerk.app.lightfast.localhost:${secondWorktree.appPorts["lightfast-app"]}`,
	);
	assert.notEqual(secondWorktree.appPorts["lightfast-app"], main.appPorts["lightfast-app"]);
	assert.notEqual(secondWorktree.appPorts["lightfast-app"], worktree.appPorts["lightfast-app"]);
	assertValidMicrofrontendsDevConfig(secondWorktree.generatedConfig);
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

test("resolveRelatedProjectUrl resolves development URLs through Portless microfrontends", () => {
	const root = createFixtureWorkspace();
	const localUrl = resolveRelatedProjectUrl("platform", {
		cwd: root,
		env: {
			NODE_ENV: "development",
			PORTLESS_HTTPS: "0",
			PORTLESS_PORT: "1355",
		},
		getPortlessUrl: () => undefined,
		detectWorktreePrefix: () => "fix-ui",
	});

	assert.equal(localUrl, "http://fix-ui.platform.mfe.localhost:1355/");
});

test("resolveRelatedProjectUrl resolves production fallbacks from microfrontends config", () => {
	const root = createLightfastFixtureWorkspace();

	assert.equal(
		resolveRelatedProjectUrl("lightfast-app", {
			cwd: root,
			env: {
				NODE_ENV: "production",
			},
		}),
		"https://lightfast-app.vercel.app",
	);
	assert.equal(
		resolveRelatedProjectUrl("lightfast-www", {
			path: "/docs",
			cwd: root,
			env: {
				NODE_ENV: "production",
			},
		}),
		"https://lightfast-www.vercel.app/docs",
	);
});

test("resolveRelatedProjectUrl normalizes localhost and full fallback URLs", () => {
	const root = createFixtureWorkspace();
	const sourceConfig = {
		applications: {
			app: {
				development: {
					fallback: "app.localhost",
				},
			},
			api: {
				development: {
					fallback: "http://api.localhost:3000",
				},
			},
		},
	};

	assert.equal(
		resolveRelatedProjectUrl("app", {
			cwd: root,
			env: {
				NODE_ENV: "production",
			},
			sourceConfig,
		}),
		"http://app.localhost",
	);
	assert.equal(
		resolveRelatedProjectUrl("api", {
			path: "/ping",
			cwd: root,
			env: {
				NODE_ENV: "production",
			},
			sourceConfig,
		}),
		"http://api.localhost:3000/ping",
	);
});

test("resolveRelatedProjectUrl reports unknown microfrontend apps", () => {
	const root = createFixtureWorkspace();

	assert.throws(
		() =>
			resolveRelatedProjectUrl("missing", {
				cwd: root,
				env: {
					NODE_ENV: "production",
				},
			}),
		/Unknown app "missing"\. Available apps: app, platform, www/,
	);
});

test("resolveRelatedProjectUrl requires microfrontends fallback outside development", () => {
	const root = createFixtureWorkspace();

	assert.throws(
		() =>
			resolveRelatedProjectUrl("app", {
				cwd: root,
				env: {
					NODE_ENV: "production",
				},
				sourceConfig: {
					applications: {
						app: {},
					},
				},
			}),
		/App "app" must define development\.fallback in microfrontends config/,
	);
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

function getGeneratedLocal(
	result: VercelMicrofrontendsDevConfigResult,
	appName: string,
): string | undefined {
	const appConfig = result.generatedConfig.applications?.[appName];
	const local = appConfig?.development?.local;
	return typeof local === "string" ? local : undefined;
}

function expectedAppPorts(
	appNames: string[],
	host: string,
	baseHost: string,
): Record<string, number> {
	const usedPorts = new Set<number>();
	return Object.fromEntries(
		appNames.map((appName) => {
			const seed = host === baseHost ? appName : `${host}:${appName}`;
			const port = generateMicrofrontendsPort(seed, { usedPorts });
			usedPorts.add(port);
			return [appName, port];
		}),
	);
}

function assertValidMicrofrontendsDevConfig(
	config: MicrofrontendsSourceConfig,
): void {
	assert.equal(typeof config.options?.localProxyPort, "number");
	for (const [appName, appConfig] of Object.entries(config.applications ?? {})) {
		assert.equal(
			typeof appConfig.development?.fallback,
			"string",
			`${appName} must keep a development fallback`,
		);
		assert.equal(
			typeof appConfig.development?.local,
			"string",
			`${appName} must use a URL development.local`,
		);
		assert.doesNotThrow(() => new URL(appConfig.development?.local as string));
	}
}

function writeJson(filePath: string, value: unknown) {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function runNode(args: string[], options: { cwd?: string } = {}) {
	return spawnSync(process.execPath, args, {
		cwd: options.cwd ?? process.cwd(),
		encoding: "utf8",
	});
}

function assertNodeOk(result: ReturnType<typeof runNode>) {
	assert.equal(
		result.status,
		0,
		[result.stdout, result.stderr].filter(Boolean).join("\n"),
	);
}
