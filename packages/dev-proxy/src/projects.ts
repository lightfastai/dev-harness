import {
	loadAppRegistry,
	loadPortlessMfeConfigSync,
	normalizePackageConfig,
	resolvePortlessAppUrl,
	resolveRegistryEntry,
	withTargetPath,
} from "./index.js";
import type {
	DetectWorktreePrefix,
	Env,
	GetPortlessUrl,
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
		getPortlessUrl,
		detectWorktreePrefix,
	}: ResolveProjectUrlOptions = {},
): string {
	if (!projectName) {
		throw new Error("resolveProjectUrl requires a project name.");
	}

	const normalized = resolveConfig({ cwd, config, configPath });
	const registry = loadAppRegistry(normalized);
	const entry = resolveRegistryEntry(registry, projectName);

	if (!entry) {
		throw new Error(
			`Unknown app "${projectName}". Available apps: ${registry.entries
				.map((e) => e.name)
				.join(", ")}`,
		);
	}

	if (env.NODE_ENV === "development") {
		return resolvePortlessAppUrl({
			app: entry.name,
			path: targetPath,
			cwd: normalized.root,
			env,
			config: normalized,
			getPortlessUrl,
			detectWorktreePrefix,
		});
	}

	const fallbackUrl = normalizeFallbackUrl(entry.fallback);
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
