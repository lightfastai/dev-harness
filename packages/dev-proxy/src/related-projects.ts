import fs from "node:fs";
import path from "node:path";
import {
	loadPortlessMfeConfigSync,
	normalizePackageConfig,
	resolvePortlessApplicationUrl,
	withTargetPath,
} from "./index.js";
import type {
	DetectWorktreePrefix,
	Env,
	GetPortlessUrl,
	MicrofrontendApplicationConfig,
	MicrofrontendsSourceConfig,
	NormalizedPortlessMfeConfig,
	PortlessMfeConfig,
} from "./index.js";

export interface ResolveRelatedProjectUrlOptions {
	path?: string;
	cwd?: string;
	env?: Env;
	config?: PortlessMfeConfig | NormalizedPortlessMfeConfig;
	configPath?: string;
	sourceConfig?: MicrofrontendsSourceConfig;
	getPortlessUrl?: GetPortlessUrl;
	detectWorktreePrefix?: DetectWorktreePrefix;
}

export function resolveRelatedProjectUrl(
	projectName: string,
	{
		path: targetPath,
		cwd = process.cwd(),
		env = process.env,
		config,
		configPath,
		sourceConfig,
		getPortlessUrl,
		detectWorktreePrefix,
	}: ResolveRelatedProjectUrlOptions = {},
): string {
	if (!projectName) {
		throw new Error("resolveRelatedProjectUrl requires a project name.");
	}

	const normalized = resolveConfig({ cwd, config, configPath });
	const resolvedSourceConfig = sourceConfig ?? readMicrofrontendsConfig(normalized);
	const applications = resolvedSourceConfig.applications ?? {};
	const appName = resolveRequestedApplicationName(applications, projectName);

	if (!appName) {
		throw new Error(
			`Unknown app "${projectName}". Available apps: ${Object.keys(applications).join(", ")}`,
		);
	}

	if (env.NODE_ENV === "development") {
		return resolvePortlessApplicationUrl({
			app: appName,
			path: targetPath,
			cwd: normalized.root,
			env,
			config: normalized,
			sourceConfig: resolvedSourceConfig,
			getPortlessUrl,
			detectWorktreePrefix,
		});
	}

	const fallbackUrl = normalizeFallbackUrl(
		resolveDevelopmentFallback(appName, applications[appName]),
	);
	return targetPath ? withTargetPath(fallbackUrl, targetPath) : fallbackUrl;
}

function resolveConfig({
	cwd,
	config,
	configPath,
}: {
	cwd: string;
	config?: PortlessMfeConfig | NormalizedPortlessMfeConfig;
	configPath?: string;
}): NormalizedPortlessMfeConfig {
	if (config) {
		return normalizePackageConfig(config, {
			root: config.root ?? cwd,
			configPath: config.configPath ?? configPath,
		});
	}

	return loadPortlessMfeConfigSync({ cwd, configPath });
}

function readMicrofrontendsConfig(
	config: PortlessMfeConfig | NormalizedPortlessMfeConfig,
): MicrofrontendsSourceConfig {
	const normalized = normalizePackageConfig(config, { root: config.root ?? process.cwd() });
	const sourcePath = path.resolve(normalized.root, normalized.microfrontends.config);
	return JSON.parse(fs.readFileSync(sourcePath, "utf8")) as MicrofrontendsSourceConfig;
}

function resolveRequestedApplicationName(
	applications: Record<string, MicrofrontendApplicationConfig> = {},
	requestedApp: string,
): string | undefined {
	if (Object.hasOwn(applications, requestedApp)) {
		return requestedApp;
	}

	const matches = Object.entries(applications)
		.filter(([, appConfig]) => {
			const packageName = appConfig?.packageName;
			return packageName === requestedApp || packageShortName(packageName ?? "") === requestedApp;
		})
		.map(([appName]) => appName);

	if (matches.length === 1) {
		return matches[0];
	}

	return undefined;
}

function resolveDevelopmentFallback(
	appName: string,
	appConfig: MicrofrontendApplicationConfig = {},
): string {
	const fallback = appConfig.development?.fallback;
	if (typeof fallback !== "string" || !fallback.trim()) {
		throw new Error(`App "${appName}" must define development.fallback in microfrontends config.`);
	}

	return fallback.trim();
}

function normalizeFallbackUrl(fallback: string): string {
	if (/^https?:\/\//i.test(fallback)) {
		return fallback;
	}

	const host = fallback.split(/[/?#]/, 1)[0] ?? fallback;
	const hostname = host.split(":", 1)[0] ?? host;
	const protocol =
		hostname === "localhost" || hostname.endsWith(".localhost") ? "http" : "https";
	return `${protocol}://${fallback}`;
}

function packageShortName(name: string): string {
	return name.split("/").pop() ?? name;
}
