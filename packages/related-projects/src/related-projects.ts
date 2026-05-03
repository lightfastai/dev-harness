import { withRelatedProject } from "@vercel/related-projects";
import {
	loadPortlessMfeConfigSync,
	normalizePackageConfig,
	resolvePortlessUrl,
	withTargetPath,
} from "./index.js";
import type {
	DetectWorktreePrefix,
	Env,
	GetPortlessUrl,
	NormalizedPortlessMfeConfig,
	PortlessMfeConfig,
} from "./index.js";

export interface ResolveRelatedProjectUrlOptions {
	key?: string;
	projectName?: string;
	fallbackHost?: string;
	portlessName?: string;
	path?: string;
	cwd?: string;
	env?: Env;
	config?: PortlessMfeConfig | NormalizedPortlessMfeConfig;
	configPath?: string;
	getPortlessUrl?: GetPortlessUrl;
	detectWorktreePrefix?: DetectWorktreePrefix;
}

export function resolveRelatedProjectUrl({
	key,
	projectName,
	fallbackHost,
	portlessName,
	path,
	cwd = process.cwd(),
	env = process.env,
	config,
	configPath,
	getPortlessUrl,
	detectWorktreePrefix,
}: ResolveRelatedProjectUrlOptions = {}): string {
	const normalized = resolveConfig({ cwd, config, configPath });
	const relatedConfig = key ? normalized.relatedProjects?.[key] : undefined;
	const resolvedKey = key ?? projectName ?? portlessName;
	const resolvedProjectName = projectName ?? relatedConfig?.projectName ?? resolvedKey;

	if (!resolvedProjectName) {
		throw new Error("resolveRelatedProjectUrl requires a projectName or key.");
	}

	const resolvedPath = path ?? relatedConfig?.path;
	const resolvedPortlessName =
		portlessName ??
		relatedConfig?.portlessName ??
		(resolvedKey ? `${resolvedKey}.${normalized.portless.name}` : resolvedProjectName);
	const localUrl = resolvePortlessUrl({
		name: resolvedPortlessName,
		cwd: normalized.root,
		env,
		config: normalized,
		getPortlessUrl,
		detectWorktreePrefix,
		preferCurrentPortlessUrl: false,
	});
	const runtimeFallbackHost = isVercelRuntime(env)
		? fallbackHost ?? relatedConfig?.fallbackHost ?? localUrl
		: localUrl;
	const relatedUrl = withRelatedProject({
		projectName: resolvedProjectName,
		defaultHost: runtimeFallbackHost,
	});

	return resolvedPath ? withTargetPath(relatedUrl, resolvedPath) : relatedUrl;
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

	try {
		return loadPortlessMfeConfigSync({ cwd, configPath });
	} catch {
		return normalizePackageConfig({}, { root: cwd, configPath });
	}
}

function isVercelRuntime(env: Env): boolean {
	const vercelEnv = env.VERCEL_ENV ?? env.NEXT_PUBLIC_VERCEL_ENV;
	return env.VERCEL === "1" || vercelEnv === "production" || vercelEnv === "preview";
}
