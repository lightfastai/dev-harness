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
	getPortlessProxyOrigins,
	inferLocalAppNames,
	loadAppRegistry,
	loadPortlessMfeConfig,
	loadPortlessMfeConfigSync,
	resolvePortlessAppUrl,
	resolvePortlessApplicationUrl,
	resolvePortlessMfeRuntime,
	resolvePortlessUrl,
	resolveRuntimeIdentity,
	resolveTargetUrl,
	selectLocalAppNames,
	synthesizeApplicationsFromRegistry,
} from "../src/index.js";
import { withPortlessProxy } from "../src/next.js";
import { relatedProjects, resolveProjectUrl, withProject } from "../src/projects.js";
import {
	buildAppDirsFromRegistry,
	filterMfeLocalApps,
	prepareDevCommandEnv,
	promoteDevProxyAppCommandEnv,
} from "../src/runtime.js";
import type {
	MicrofrontendApplicationConfig,
	MicrofrontendsSourceConfig,
	VercelMicrofrontendsDevConfigResult,
} from "../src/index.js";

const require = createRequire(import.meta.url);

interface NextConfigLike {
	reactStrictMode?: boolean;
	allowedDevOrigins?: string[];
}

test("loadPortlessMfeConfig reads JSON config and applies fixed defaults", async () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "dev-proxy-config-"));
	writeJson(path.join(root, "lightfast.dev.json"), {
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

	assert.equal(config.configPath, path.join(root, "lightfast.dev.json"));
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
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "dev-proxy-runtime-"));
	writeJson(path.join(root, "lightfast.dev.json"), {
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

test("withPortlessProxy adds config-derived local origins to Next config", () => {
	const root = createFixtureWorkspace();
	writeJson(path.join(root, "lightfast.dev.json"), {
		portless: {
			name: "mfe",
			tld: "localhost",
		},
		apps: {
			app: { packageName: "app", devPort: 4001, fallback: "app.localhost", mfe: true },
			platform: {
				packageName: "@repo/platform",
				devPort: 4002,
				fallback: "platform.localhost",
				mfe: true,
			},
			www: { packageName: "www", devPort: 4003, fallback: "www.localhost", mfe: true },
		},
		microfrontends: {
			config: "apps/app/microfrontends.json",
		},
	});

	assert.deepEqual(getPortlessProxyOrigins({ cwd: root }), [
		"mfe.localhost",
		"*.mfe.localhost",
		"app.mfe.localhost",
		"*.app.mfe.localhost",
		"platform.mfe.localhost",
		"*.platform.mfe.localhost",
		"www.mfe.localhost",
		"*.www.mfe.localhost",
	]);
	assert.deepEqual(getPortlessProxyOrigins({ cwd: root, includePort: true }), [
		"mfe.localhost:1355",
		"*.mfe.localhost:1355",
		"app.mfe.localhost:1355",
		"*.app.mfe.localhost:1355",
		"platform.mfe.localhost:1355",
		"*.platform.mfe.localhost:1355",
		"www.mfe.localhost:1355",
		"*.www.mfe.localhost:1355",
	]);
	assert.deepEqual(getPortlessProxyOrigins({ cwd: root, includePort: "both" }), [
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
		getPortlessProxyOrigins({
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

	const wrapped = withPortlessProxy(
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
		withPortlessProxy(
			{ reactStrictMode: true },
			{ cwd: path.join(os.tmpdir(), "missing-dev-proxy") },
		),
		{ reactStrictMode: true },
	);

	const nextConfigLike: NextConfigLike = { reactStrictMode: true };
	const wrappedNextConfigLike: NextConfigLike = withPortlessProxy(
		nextConfigLike,
		{ origins: ["typed.localhost"] },
	);
	assert.deepEqual(wrappedNextConfigLike, {
		reactStrictMode: true,
		allowedDevOrigins: ["typed.localhost"],
	});
});

test("withPortlessProxy populates serverActions allowedOrigins when serverActions: true", () => {
	const root = createFixtureWorkspace();
	writeJson(path.join(root, "lightfast.dev.json"), {
		portless: {
			name: "mfe",
			tld: "localhost",
		},
		apps: {
			app: { packageName: "app", devPort: 4001, fallback: "app.localhost", mfe: true },
			platform: {
				packageName: "@repo/platform",
				devPort: 4002,
				fallback: "platform.localhost",
				mfe: true,
			},
			www: { packageName: "www", devPort: 4003, fallback: "www.localhost", mfe: true },
		},
		microfrontends: {
			config: "apps/app/microfrontends.json",
		},
	});

	const wrapped = withPortlessProxy(
		{ reactStrictMode: true },
		{ cwd: root, serverActions: true },
	) as { reactStrictMode: boolean; allowedDevOrigins?: string[]; experimental?: { serverActions?: { allowedOrigins?: string[] } } };

	assert.deepEqual(wrapped.experimental?.serverActions?.allowedOrigins, [
		"mfe.localhost",
		"*.mfe.localhost",
		"app.mfe.localhost",
		"*.app.mfe.localhost",
		"platform.mfe.localhost",
		"*.platform.mfe.localhost",
		"www.mfe.localhost",
		"*.www.mfe.localhost",
	]);
	assert.deepEqual(wrapped.allowedDevOrigins, wrapped.experimental?.serverActions?.allowedOrigins);
});

test("withPortlessProxy serverActions includePort:both populates port-suffixed origins", () => {
	const root = createFixtureWorkspace();
	writeJson(path.join(root, "lightfast.dev.json"), {
		portless: {
			name: "mfe",
			tld: "localhost",
		},
		apps: {
			app: { packageName: "app", devPort: 4001, fallback: "app.localhost", mfe: true },
			platform: {
				packageName: "@repo/platform",
				devPort: 4002,
				fallback: "platform.localhost",
				mfe: true,
			},
			www: { packageName: "www", devPort: 4003, fallback: "www.localhost", mfe: true },
		},
		microfrontends: {
			config: "apps/app/microfrontends.json",
		},
	});

	const wrapped = withPortlessProxy(
		{ reactStrictMode: true },
		{ cwd: root, serverActions: { includePort: "both" } },
	) as { experimental?: { serverActions?: { allowedOrigins?: string[] } }; allowedDevOrigins?: string[] };

	const serverActionOrigins = wrapped.experimental?.serverActions?.allowedOrigins ?? [];
	assert.equal(serverActionOrigins.includes("app.mfe.localhost"), true);
	assert.equal(serverActionOrigins.includes("app.mfe.localhost:1355"), true);
	assert.equal(serverActionOrigins.includes("*.app.mfe.localhost"), true);
	assert.equal(serverActionOrigins.includes("*.app.mfe.localhost:1355"), true);

	assert.equal((wrapped.allowedDevOrigins ?? []).includes("app.mfe.localhost"), true);
	assert.equal((wrapped.allowedDevOrigins ?? []).includes("app.mfe.localhost:1355"), false);
});

test("withPortlessProxy leaves experimental untouched when serverActions is omitted", () => {
	const root = createFixtureWorkspace();
	writeJson(path.join(root, "lightfast.dev.json"), {
		portless: {
			name: "mfe",
			tld: "localhost",
		},
		apps: {
			app: { packageName: "app", devPort: 4001, fallback: "app.localhost", mfe: true },
			platform: {
				packageName: "@repo/platform",
				devPort: 4002,
				fallback: "platform.localhost",
				mfe: true,
			},
			www: { packageName: "www", devPort: 4003, fallback: "www.localhost", mfe: true },
		},
		microfrontends: {
			config: "apps/app/microfrontends.json",
		},
	});

	const wrapped = withPortlessProxy(
		{ reactStrictMode: true },
		{ cwd: root },
	) as { experimental?: unknown };

	assert.equal("experimental" in wrapped, false);
});

test("CommonJS Next wrapper exports the same helpers", () => {
	const cjsNext = require("../src/next.cjs") as typeof import("../src/next.js");

	assert.equal(typeof cjsNext.withPortlessProxy, "function");
	assert.equal(typeof cjsNext.getPortlessProxyOrigins, "function");
	assert.deepEqual(
		cjsNext.withPortlessProxy(
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
			const publicApi = await import("@lightfastai/dev-proxy");
			const nextApi = await import("@lightfastai/dev-proxy/next");
			const projectApi = await import("@lightfastai/dev-proxy/projects");
			if (typeof publicApi.resolvePortlessMfeRuntime !== "function") throw new Error("missing public API");
			if (typeof nextApi.withPortlessProxy !== "function") throw new Error("missing next API");
			if (typeof projectApi.resolveProjectUrl !== "function") throw new Error("missing projects API");
		`,
	]);

	assertNodeOk(result);
});

test("package export map supports CommonJS require for Next helpers", () => {
	const result = runNode([
		"--eval",
		`
			const nextApi = require("@lightfastai/dev-proxy/next");
			if (typeof nextApi.withPortlessProxy !== "function") throw new Error("missing next API");
		`,
	]);

	assertNodeOk(result);
});

test("package export map supports CommonJS require for project helpers", () => {
	const result = runNode([
		"--eval",
		`
			const projectApi = require("@lightfastai/dev-proxy/projects");
			if (typeof projectApi.withProject !== "function") throw new Error("missing withProject API");
			if (typeof projectApi.resolveProjectUrl !== "function") throw new Error("missing resolveProjectUrl API");
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

test("createVercelMicrofrontendsDevConfig synthesizes applications from registry", async () => {
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
			apps: {
				app: { packageName: "app", devPort: 4001, fallback: "app.localhost", mfe: true },
				platform: {
					packageName: "@repo/platform",
					devPort: 4002,
					fallback: "platform.localhost",
					mfe: true,
				},
				www: { packageName: "www", devPort: 4003, fallback: "www.localhost", mfe: true },
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
	assert.deepEqual(result.appPorts, { app: 4001, platform: 4002, www: 4003 });
	assert.equal("appBridgePorts" in result, false);
	const generatedConfig = result.generatedConfig as MicrofrontendsSourceConfig & {
		applications: {
			app: {
				development: {
					local: number;
				};
			};
			platform: {
				development: {
					local: number;
				};
			};
			www: {
				development: {
					local: number;
				};
				routing: Array<{ paths: string[] }>;
			};
		};
	};
	assert.equal(generatedConfig.applications.app.development.local, result.appPorts.app);
	assert.equal(generatedConfig.applications.platform.development.local, result.appPorts.platform);
	assert.equal(generatedConfig.applications.www.development.local, result.appPorts.www);
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

test("createVercelMicrofrontendsDevConfig uses explicit registry devPorts across worktrees", async () => {
	const root = createLightfastFixtureWorkspace();
	const baseConfig = {
		root,
		portless: {
			name: "lightfast",
			port: 443,
			https: true,
		},
		apps: {
			"lightfast-app": {
				packageName: "@lightfast/app",
				devPort: 4107,
				fallback: "lightfast-app.vercel.app",
				mfe: true,
			},
			"lightfast-www": {
				packageName: "@lightfast/www",
				devPort: 4101,
				portlessName: "docs.lightfast",
				fallback: "lightfast-www.vercel.app",
				mfe: true,
			},
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

	assert.equal(main.host, "lightfast.localhost");
	assert.equal(main.appUrls["lightfast-app"], "https://app.lightfast.localhost/");
	assert.equal(main.appPorts["lightfast-app"], 4107);
	assert.equal(main.appPorts["lightfast-www"], 4101);
	assert.equal(getGeneratedLocal(main, "lightfast-app"), 4107);
	assert.equal("appBridgePorts" in main, false);
	assertValidMicrofrontendsDevConfig(main.generatedConfig);

	assert.equal(worktree.host, "fix-ui.lightfast.localhost");
	assert.equal(
		worktree.appUrls["lightfast-app"],
		"https://fix-ui.app.lightfast.localhost/",
	);
	assert.equal(worktree.appPorts["lightfast-app"], 4107);
	assert.equal(getGeneratedLocal(worktree, "lightfast-app"), 4107);
	assert.equal("appBridgePorts" in worktree, false);
	assertValidMicrofrontendsDevConfig(worktree.generatedConfig);
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

test("dev-proxy turbo helpers inject dev env and Turbo loose env mode", () => {
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

test("dev-proxy hides MFE config from Turbo and restores it for app commands", () => {
	const result = {
		localProxyPort: 9123,
		generatedConfigPath: "/repo/apps/app/microfrontends.local.json",
		runtimeConfigFilename: "microfrontends.local.json",
	};
	const env = createVercelMicrofrontendsDevEnv({
		result,
		localApps: ["lightfast-app", "lightfast-www"],
		env: {
			HOST: "0.0.0.0",
			PORT: "443",
			PORTLESS_PORT: "1455",
			PORTLESS_URL: "http://lightfast.localhost:1455",
		},
	});

	const turboEnv = prepareDevCommandEnv(["turbo", "run", "dev"], env);

	assert.equal(turboEnv.HOST, undefined);
	assert.equal(turboEnv.PORT, undefined);
	assert.equal(turboEnv.PORTLESS_URL, undefined);
	assert.equal(turboEnv.PORTLESS_PORT, "1455");
	assert.equal(turboEnv.MFE_LOCAL_PROXY_PORT, undefined);
	assert.equal(turboEnv.VC_MICROFRONTENDS_CONFIG, undefined);
	assert.equal(turboEnv.VC_MICROFRONTENDS_CONFIG_FILE_NAME, "lightfast-dev-no-turbo-mfe.json");
	assert.equal(turboEnv.LIGHTFAST_DEV_PROXY_LOCAL_PROXY_PORT, "9123");
	assert.equal(turboEnv.LIGHTFAST_DEV_PROXY_DISABLE_PROXY_REWRITE, "1");
	assert.equal(turboEnv.LIGHTFAST_DEV_PROXY_LOCAL_APPS, "lightfast-app,lightfast-www");
	assert.equal(turboEnv.LIGHTFAST_DEV_PROXY_CONFIG_PATH, "/repo/apps/app/microfrontends.local.json");
	assert.equal(turboEnv.LIGHTFAST_DEV_PROXY_CONFIG_FILE_NAME, "microfrontends.local.json");

	const appEnv = promoteDevProxyAppCommandEnv(turboEnv);
	assert.equal(appEnv.MFE_LOCAL_PROXY_PORT, "9123");
	assert.equal(appEnv.MFE_DISABLE_LOCAL_PROXY_REWRITE, "1");
	assert.equal(appEnv.PORTLESS_MFE_LOCAL_APPS, "lightfast-app,lightfast-www");
	assert.equal(appEnv.VC_MICROFRONTENDS_CONFIG, "/repo/apps/app/microfrontends.local.json");
	assert.equal(appEnv.VC_MICROFRONTENDS_CONFIG_FILE_NAME, "microfrontends.local.json");

	const explicitAppEnv = promoteDevProxyAppCommandEnv({
		...turboEnv,
		VC_MICROFRONTENDS_CONFIG: "/repo/custom.json",
		VC_MICROFRONTENDS_CONFIG_FILE_NAME: "custom.json",
	});
	assert.equal(explicitAppEnv.VC_MICROFRONTENDS_CONFIG, "/repo/apps/app/microfrontends.local.json");
	assert.equal(explicitAppEnv.VC_MICROFRONTENDS_CONFIG_FILE_NAME, "microfrontends.local.json");
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

test("resolveProjectUrl resolves development URLs through Portless microfrontends", () => {
	const root = createFixtureWorkspace();
	const localUrl = resolveProjectUrl("platform", {
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

test("resolveProjectUrl resolves production fallbacks from registry", () => {
	const root = createLightfastFixtureWorkspace();

	assert.equal(
		resolveProjectUrl("lightfast-app", {
			cwd: root,
			env: {
				NODE_ENV: "production",
			},
		}),
		"https://lightfast-app.vercel.app",
	);
	assert.equal(
		resolveProjectUrl("lightfast-www", {
			path: "/docs",
			cwd: root,
			env: {
				NODE_ENV: "production",
			},
		}),
		"https://lightfast-www.vercel.app/docs",
	);
});

test("resolveProjectUrl normalizes localhost and full fallback URLs", () => {
	const root = createFixtureWorkspace();

	assert.equal(
		resolveProjectUrl("app", {
			cwd: root,
			env: {
				NODE_ENV: "production",
			},
		}),
		"http://app.localhost",
	);
	assert.equal(
		resolveProjectUrl("platform", {
			path: "/ping",
			cwd: root,
			env: {
				NODE_ENV: "production",
			},
		}),
		"http://platform.localhost/ping",
	);
});

test("resolveProjectUrl reports unknown microfrontend apps", () => {
	const root = createFixtureWorkspace();

	assert.throws(
		() =>
			resolveProjectUrl("missing", {
				cwd: root,
				env: {
					NODE_ENV: "production",
				},
			}),
		/Unknown app "missing"\. Available apps: app, platform, www/,
	);
});

test("resolveProjectUrl falls back to default URL when registry entry has no fallback", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "dev-proxy-default-fallback-"));
	fs.writeFileSync(
		path.join(root, "pnpm-workspace.yaml"),
		'packages:\n  - "apps/*"\n',
	);
	writeJson(path.join(root, "apps/app/package.json"), { name: "app" });
	writeJson(path.join(root, "lightfast.dev.json"), {
		portless: { name: "mfe", port: 1355 },
		apps: {
			app: { packageName: "app", devPort: 4001, mfe: true },
		},
		microfrontends: { config: "apps/app/microfrontends.json" },
	});

	assert.equal(
		resolveProjectUrl("app", {
			cwd: root,
			env: {
				NODE_ENV: "production",
			},
		}),
		"https://lightfast.ai",
	);
});

test("withProject resolves Vercel related projects without external package dependency", () => {
	const env = {
		VERCEL_ENV: "preview",
		VERCEL_RELATED_PROJECTS: JSON.stringify([
			{
				project: { name: "app" },
				preview: { branch: "app-git-preview.vercel.app" },
				production: { alias: "app.example.com", url: "app-prod.vercel.app" },
			},
			{
				project: { name: "www" },
				preview: { customEnvironment: "www-custom.vercel.app", branch: "www-git.vercel.app" },
				production: { url: "www-prod.vercel.app" },
			},
		]),
	};

	assert.equal(
		withProject({ projectName: "app", defaultHost: "http://localhost:3000", env }),
		"https://app-git-preview.vercel.app",
	);
	assert.equal(
		withProject({ projectName: "www", defaultHost: "http://localhost:3001", env }),
		"https://www-custom.vercel.app",
	);
	assert.equal(
		withProject({
			projectName: "app",
			defaultHost: "http://localhost:3000",
			env: { ...env, VERCEL_ENV: "production" },
		}),
		"https://app.example.com",
	);
	assert.equal(
		withProject({ projectName: "missing", defaultHost: "http://localhost:3002", env }),
		"http://localhost:3002",
	);
});

test("relatedProjects reports missing or invalid Vercel related project env", () => {
	assert.deepEqual(relatedProjects({ env: {}, noThrow: true }), []);
	assert.throws(
		() => relatedProjects({ env: {} }),
		/Missing required environment variable: VERCEL_RELATED_PROJECTS/,
	);
	assert.deepEqual(
		relatedProjects({ env: { VERCEL_RELATED_PROJECTS: "not-json" }, noThrow: true }),
		[],
	);
	assert.throws(
		() => relatedProjects({ env: { VERCEL_RELATED_PROJECTS: "not-json" } }),
		/Invalid JSON in VERCEL_RELATED_PROJECTS/,
	);
});

test("loadAppRegistry returns entries with computed portless names and defaults", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "dev-proxy-registry-"));
	writeJson(path.join(root, "lightfast.dev.json"), {
		portless: { name: "lightfast" },
		apps: {
			"lightfast-app": {
				packageName: "@lightfast/app",
				devPort: 4107,
				mfe: true,
			},
			"lightfast-platform": {
				packageName: "@lightfast/platform",
				devPort: 4112,
				mfe: false,
			},
			"lightfast-www": {
				packageName: "@lightfast/www",
				devPort: 4101,
				portlessName: "docs.lightfast",
				fallback: "https://lightfast-www.vercel.app",
				mfe: true,
			},
		},
		microfrontends: { config: "apps/app/microfrontends.json" },
	});

	const config = loadPortlessMfeConfigSync({ cwd: root });
	const registry = loadAppRegistry(config);

	assert.equal(registry.entries.length, 3);
	const app = registry.byName["lightfast-app"];
	assert.equal(app.packageName, "@lightfast/app");
	assert.equal(app.devPort, 4107);
	assert.equal(app.portlessName, "app.lightfast");
	assert.equal(app.fallback, "https://lightfast.ai");
	assert.equal(app.mfe, true);

	const platform = registry.byName["lightfast-platform"];
	assert.equal(platform.mfe, false);
	assert.equal(platform.portlessName, "platform.lightfast");

	const www = registry.byName["lightfast-www"];
	assert.equal(www.portlessName, "docs.lightfast");
	assert.equal(www.fallback, "https://lightfast-www.vercel.app");
});

test("loadAppRegistry throws when apps is missing", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "dev-proxy-no-apps-"));
	writeJson(path.join(root, "lightfast.dev.json"), {
		portless: { name: "lightfast" },
		microfrontends: { config: "apps/app/microfrontends.json" },
	});

	assert.throws(
		() => loadAppRegistry(loadPortlessMfeConfigSync({ cwd: root })),
		/lightfast\.dev\.json must declare a non-empty 'apps' registry; deriving from microfrontends\.json is no longer supported in dev-proxy@0\.3\.0\+\./,
	);
});

test("loadAppRegistry throws when apps is empty", () => {
	assert.throws(
		() => loadAppRegistry({ apps: {} } as never),
		/lightfast\.dev\.json must declare a non-empty 'apps' registry/,
	);
});

test("loadAppRegistry throws when an entry is missing the mfe flag", () => {
	assert.throws(
		() =>
			loadAppRegistry({
				portless: { name: "lightfast" },
				apps: {
					"lightfast-app": {
						packageName: "@lightfast/app",
						devPort: 4107,
					},
				},
			} as never),
		/apps\.lightfast-app\.mfe must be a boolean\./,
	);
});

test("loadAppRegistry throws when devPort is out of range", () => {
	assert.throws(
		() =>
			loadAppRegistry({
				apps: {
					app: {
						packageName: "app",
						devPort: 0,
						mfe: true,
					},
				},
			} as never),
		/apps\.app\.devPort must be an integer between 1 and 65535\./,
	);
});

test("loadAppRegistry attaches routing arrays from microfrontends.json for MFE apps", () => {
	const root = createLightfastFixtureWorkspace();
	writeJson(path.join(root, "apps/app/microfrontends.json"), {
		applications: {
			"lightfast-app": {},
			"lightfast-www": {
				routing: [
					{ group: "marketing", paths: ["/", "/docs", "/docs/:path*"] },
				],
			},
		},
	});

	const registry = loadAppRegistry(loadPortlessMfeConfigSync({ cwd: root }));
	assert.equal(Array.isArray(registry.byName["lightfast-www"].routing), true);
	assert.equal(registry.byName["lightfast-app"].routing, undefined);
});

test("synthesizeApplicationsFromRegistry includes only mfe entries with packageName, fallback, and routing", () => {
	const registry = loadAppRegistry({
		portless: { name: "lightfast" },
		apps: {
			"lightfast-app": {
				packageName: "@lightfast/app",
				devPort: 4107,
				fallback: "https://app.example.com",
				mfe: true,
			},
			"lightfast-platform": {
				packageName: "@lightfast/platform",
				devPort: 4112,
				mfe: false,
			},
		},
	} as never);

	const applications = synthesizeApplicationsFromRegistry(registry);
	assert.deepEqual(Object.keys(applications), ["lightfast-app"]);
	assert.deepEqual(applications["lightfast-app"], {
		packageName: "@lightfast/app",
		development: { fallback: "https://app.example.com" },
	});
});

test("getPortlessProxyOrigins includes non-MFE app subdomains from registry", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "dev-proxy-non-mfe-origins-"));
	fs.writeFileSync(
		path.join(root, "pnpm-workspace.yaml"),
		'packages:\n  - "apps/*"\n',
	);
	writeJson(path.join(root, "apps/app/package.json"), { name: "@lightfast/app" });
	writeJson(path.join(root, "apps/platform/package.json"), {
		name: "@lightfast/platform",
	});
	writeJson(path.join(root, "lightfast.dev.json"), {
		portless: { name: "lightfast", tld: "localhost" },
		apps: {
			"lightfast-app": {
				packageName: "@lightfast/app",
				devPort: 4107,
				mfe: true,
			},
			"lightfast-platform": {
				packageName: "@lightfast/platform",
				devPort: 4112,
				mfe: false,
			},
		},
		microfrontends: { config: "apps/app/microfrontends.json" },
	});
	writeJson(path.join(root, "apps/app/microfrontends.json"), {
		applications: { "lightfast-app": {} },
	});

	const origins = getPortlessProxyOrigins({ cwd: root });
	assert.equal(origins.includes("platform.lightfast.localhost"), true);
	assert.equal(origins.includes("*.platform.lightfast.localhost"), true);
	assert.equal(origins.includes("app.lightfast.localhost"), true);
	assert.equal(origins.includes("lightfast.localhost"), true);
});

test("resolvePortlessAppUrl resolves non-MFE app subdomains", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "dev-proxy-non-mfe-url-"));
	writeJson(path.join(root, "lightfast.dev.json"), {
		portless: { name: "lightfast", port: 1355, https: false },
		apps: {
			"lightfast-platform": {
				packageName: "@lightfast/platform",
				devPort: 4112,
				mfe: false,
			},
		},
		microfrontends: { config: "apps/app/microfrontends.json" },
	});

	const url = resolvePortlessAppUrl({
		app: "lightfast-platform",
		cwd: root,
		env: {
			PORTLESS_HTTPS: "0",
			PORTLESS_PORT: "1355",
		},
		getPortlessUrl: () => undefined,
		detectWorktreePrefix: () => undefined,
	});
	assert.equal(url, "http://platform.lightfast.localhost:1355/");
});

test("resolveProjectUrl resolves a non-MFE app via registry", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "dev-proxy-non-mfe-project-"));
	writeJson(path.join(root, "lightfast.dev.json"), {
		portless: { name: "lightfast", port: 1355, https: false },
		apps: {
			"lightfast-platform": {
				packageName: "@lightfast/platform",
				devPort: 4112,
				fallback: "https://lightfast-platform.vercel.app",
				mfe: false,
			},
		},
		microfrontends: { config: "apps/app/microfrontends.json" },
	});

	assert.equal(
		resolveProjectUrl("lightfast-platform", {
			cwd: root,
			env: {
				NODE_ENV: "development",
				PORTLESS_HTTPS: "0",
				PORTLESS_PORT: "1355",
			},
			getPortlessUrl: () => undefined,
			detectWorktreePrefix: () => undefined,
		}),
		"http://platform.lightfast.localhost:1355/",
	);
	assert.equal(
		resolveProjectUrl("lightfast-platform", {
			cwd: root,
			env: { NODE_ENV: "production" },
		}),
		"https://lightfast-platform.vercel.app",
	);
});

test("filterMfeLocalApps keeps only entries with mfe=true", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "dev-proxy-filter-mfe-"));
	writeJson(path.join(root, "lightfast.dev.json"), {
		portless: { name: "lightfast", port: 1355, https: false },
		apps: {
			"lightfast-app": {
				packageName: "@lightfast/app",
				devPort: 4107,
				mfe: true,
			},
			"lightfast-www": {
				packageName: "@lightfast/www",
				devPort: 4101,
				mfe: true,
			},
			"lightfast-platform": {
				packageName: "@lightfast/platform",
				devPort: 4112,
				mfe: false,
			},
		},
		microfrontends: { config: "apps/app/microfrontends.json" },
	});

	const registry = loadAppRegistry(loadPortlessMfeConfigSync({ cwd: root }));
	assert.deepEqual(
		filterMfeLocalApps(registry, ["lightfast-app", "lightfast-platform", "lightfast-www"]),
		["lightfast-app", "lightfast-www"],
	);
	assert.deepEqual(filterMfeLocalApps(registry, ["lightfast-platform"]), []);
	assert.deepEqual(filterMfeLocalApps(registry, []), []);
});

test("buildAppDirsFromRegistry resolves dirs for both MFE and non-MFE apps", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "dev-proxy-app-dirs-"));
	fs.writeFileSync(
		path.join(root, "pnpm-workspace.yaml"),
		'packages:\n  - "apps/*"\n',
	);
	writeJson(path.join(root, "apps/app/package.json"), { name: "@lightfast/app" });
	writeJson(path.join(root, "apps/platform/package.json"), {
		name: "@lightfast/platform",
	});
	writeJson(path.join(root, "lightfast.dev.json"), {
		portless: { name: "lightfast", port: 1355, https: false },
		apps: {
			"lightfast-app": {
				packageName: "@lightfast/app",
				devPort: 4107,
				mfe: true,
			},
			"lightfast-platform": {
				packageName: "@lightfast/platform",
				devPort: 4112,
				mfe: false,
			},
		},
		microfrontends: { config: "apps/app/microfrontends.json" },
	});

	const registry = loadAppRegistry(loadPortlessMfeConfigSync({ cwd: root }));
	const appDirs = buildAppDirsFromRegistry(registry, root);
	assert.equal(appDirs["lightfast-app"], path.join(root, "apps/app"));
	assert.equal(appDirs["lightfast-platform"], path.join(root, "apps/platform"));
});

test("inferLocalAppNames resolves a non-MFE app from a cwd inside its package directory", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "dev-proxy-infer-non-mfe-"));
	fs.writeFileSync(
		path.join(root, "pnpm-workspace.yaml"),
		'packages:\n  - "apps/*"\n',
	);
	writeJson(path.join(root, "apps/app/package.json"), { name: "@lightfast/app" });
	writeJson(path.join(root, "apps/platform/package.json"), {
		name: "@lightfast/platform",
	});
	writeJson(path.join(root, "lightfast.dev.json"), {
		portless: { name: "lightfast", port: 1355, https: false },
		apps: {
			"lightfast-app": {
				packageName: "@lightfast/app",
				devPort: 4107,
				mfe: true,
			},
			"lightfast-platform": {
				packageName: "@lightfast/platform",
				devPort: 4112,
				mfe: false,
			},
		},
		microfrontends: { config: "apps/app/microfrontends.json" },
	});

	const registry = loadAppRegistry(loadPortlessMfeConfigSync({ cwd: root }));
	const appDirs = buildAppDirsFromRegistry(registry, root);
	assert.deepEqual(
		inferLocalAppNames({
			registry,
			appDirs,
			cwd: path.join(root, "apps/platform"),
			root,
			env: {},
		}),
		["lightfast-platform"],
	);
});

test("synthesizeApplicationsFromRegistry merges routing arrays from microfrontends.json", () => {
	const root = createLightfastFixtureWorkspace();
	writeJson(path.join(root, "apps/app/microfrontends.json"), {
		applications: {
			"lightfast-app": {},
			"lightfast-www": {
				routing: [
					{ group: "marketing", paths: ["/", "/docs", "/docs/:path*"] },
				],
			},
		},
	});

	const registry = loadAppRegistry(loadPortlessMfeConfigSync({ cwd: root }));
	const applications = synthesizeApplicationsFromRegistry(registry);

	assert.deepEqual(Object.keys(applications).sort(), [
		"lightfast-app",
		"lightfast-www",
	]);
	assert.equal(applications["lightfast-app"].packageName, "@lightfast/app");
	assert.equal(applications["lightfast-app"].development?.fallback, "lightfast-app.vercel.app");
	assert.equal("routing" in applications["lightfast-app"], false);

	const www = applications["lightfast-www"] as MicrofrontendApplicationConfig & {
		routing?: Array<{ group?: string; paths: string[] }>;
	};
	assert.equal(www.packageName, "@lightfast/www");
	assert.equal(www.development?.fallback, "lightfast-www.vercel.app");
	assert.equal(Array.isArray(www.routing), true);
	assert.equal(www.routing?.[0].group, "marketing");
	assert.deepEqual(www.routing?.[0].paths, ["/", "/docs", "/docs/:path*"]);
});

test("synthesizeApplicationsFromRegistry matches the lightfast-shaped microfrontends.json applications snapshot", () => {
	const root = createLightfastFixtureWorkspace();
	writeJson(path.join(root, "apps/app/microfrontends.json"), {
		applications: {
			"lightfast-app": {},
			"lightfast-www": {
				routing: [
					{ paths: ["/", "/docs", "/docs/:path*"] },
				],
			},
		},
	});

	const registry = loadAppRegistry(loadPortlessMfeConfigSync({ cwd: root }));
	assert.deepEqual(synthesizeApplicationsFromRegistry(registry), {
		"lightfast-app": {
			packageName: "@lightfast/app",
			development: { fallback: "lightfast-app.vercel.app" },
		},
		"lightfast-www": {
			packageName: "@lightfast/www",
			development: { fallback: "lightfast-www.vercel.app" },
			routing: [{ paths: ["/", "/docs", "/docs/:path*"] }],
		},
	});
});

test("config schema retains apps requirement and rejects unknown root properties", () => {
	const schemaPath = require.resolve("@lightfastai/dev-proxy/schema/config.schema.json");
	const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
	assert.equal(schema.additionalProperties, false);
	assert.deepEqual(schema.required, ["apps"]);
	assert.deepEqual(schema.properties.apps.required, undefined);
	assert.equal(schema.properties.apps.minProperties, 1);
	assert.deepEqual(
		schema.properties.apps.additionalProperties.required,
		["packageName", "devPort", "mfe"],
	);
	assert.equal(
		schema.properties.apps.additionalProperties.additionalProperties,
		false,
	);
	assert.deepEqual(
		Object.keys(schema.properties.apps.additionalProperties.properties).sort(),
		["devPort", "fallback", "mfe", "packageName", "portlessName"],
	);
});

function createFixtureWorkspace() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "dev-proxy-"));
	fs.writeFileSync(
		path.join(root, "pnpm-workspace.yaml"),
		'packages:\n  - "apps/*"\n',
	);

	writeJson(path.join(root, "apps/app/package.json"), { name: "app" });
	writeJson(path.join(root, "apps/platform/package.json"), { name: "@repo/platform" });
	writeJson(path.join(root, "apps/www/package.json"), { name: "www" });
	writeJson(path.join(root, "lightfast.dev.json"), {
		portless: {
			name: "mfe",
			port: 1355,
			https: false,
		},
		apps: {
			app: { packageName: "app", devPort: 4001, fallback: "app.localhost", mfe: true },
			platform: {
				packageName: "@repo/platform",
				devPort: 4002,
				fallback: "platform.localhost",
				mfe: true,
			},
			www: { packageName: "www", devPort: 4003, fallback: "www.localhost", mfe: true },
		},
		microfrontends: {
			config: "apps/app/microfrontends.json",
		},
	});
	writeJson(path.join(root, "apps/app/microfrontends.json"), {
		applications: {
			app: {},
			platform: {
				routing: [
					{
						paths: ["/platform", "/platform/:path*"],
					},
				],
			},
			www: {
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
	writeJson(path.join(root, "lightfast.dev.json"), {
		portless: {
			name: "lightfast",
			port: 1355,
			https: false,
		},
		apps: {
			"lightfast-app": {
				packageName: "@lightfast/app",
				devPort: 4107,
				fallback: "lightfast-app.vercel.app",
				mfe: true,
			},
			"lightfast-www": {
				packageName: "@lightfast/www",
				devPort: 4101,
				portlessName: "docs.lightfast",
				fallback: "lightfast-www.vercel.app",
				mfe: true,
			},
		},
		microfrontends: {
			config: "apps/app/microfrontends.json",
		},
	});
	writeJson(path.join(root, "apps/app/package.json"), { name: "@lightfast/app" });
	writeJson(path.join(root, "apps/www/package.json"), { name: "@lightfast/www" });
	writeJson(path.join(root, "apps/app/microfrontends.json"), {
		applications: {
			"lightfast-app": {},
			"lightfast-www": {},
		},
	});
	return root;
}

function getGeneratedLocal(
	result: VercelMicrofrontendsDevConfigResult,
	appName: string,
): unknown {
	const appConfig = result.generatedConfig.applications?.[appName];
	return appConfig?.development?.local;
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
			"number",
			`${appName} must use a numeric development.local app port`,
		);
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
