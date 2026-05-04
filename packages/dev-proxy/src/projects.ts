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

export interface RelatedProject {
	project: {
		name: string;
	};
	preview: {
		branch?: string;
		customEnvironment?: string;
	};
	production: {
		alias?: string;
		url?: string;
	};
}

export interface RelatedProjectsOptions {
	env?: Env;
	noThrow?: boolean;
}

export interface WithProjectOptions {
	projectName: string;
	defaultHost: string;
	env?: Env;
}

export interface ResolveProjectUrlOptions {
	path?: string;
	cwd?: string;
	env?: Env;
	config?: PortlessMfeConfig | NormalizedPortlessMfeConfig;
	configPath?: string;
	sourceConfig?: MicrofrontendsSourceConfig;
	getPortlessUrl?: GetPortlessUrl;
	detectWorktreePrefix?: DetectWorktreePrefix;
}

export function relatedProjects({
	env = process.env,
	noThrow = false,
}: RelatedProjectsOptions = {}): RelatedProject[] {
	const value = env.VERCEL_RELATED_PROJECTS;
	if (!value) {
		if (noThrow) {
			return [];
		}
		throw new Error("Missing required environment variable: VERCEL_RELATED_PROJECTS");
	}

	try {
		return JSON.parse(value) as RelatedProject[];
	} catch (error) {
		if (noThrow) {
			return [];
		}
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Invalid JSON in VERCEL_RELATED_PROJECTS: ${message}`);
	}
}

export function withProject({
	projectName,
	defaultHost,
	env = process.env,
}: WithProjectOptions): string {
	const projects = relatedProjects({ env, noThrow: true });
	const project = projects.find((candidate) => candidate.project.name === projectName);
	if (!project) {
		return defaultHost;
	}

	if (env.VERCEL_ENV === "preview") {
		const previewHost = project.preview.customEnvironment ?? project.preview.branch;
		if (previewHost) {
			return `https://${previewHost}`;
		}
	}

	if (env.VERCEL_ENV === "production") {
		if (project.production.alias) {
			return `https://${project.production.alias}`;
		}
		if (project.production.url) {
			return `https://${project.production.url}`;
		}
	}

	return defaultHost;
}

export function resolveProjectUrl(
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
	}: ResolveProjectUrlOptions = {},
): string {
	if (!projectName) {
		throw new Error("resolveProjectUrl requires a project name.");
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
