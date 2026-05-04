import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { defaultDetectWorktreePrefix, sanitizeWorktreePrefix } from "@lightfastai/dev-core";
import type { DetectWorktreePrefix } from "@lightfastai/dev-core";
import type { StdioOptions } from "node:child_process";

export type Env = Record<string, string | undefined>;
export type { DetectWorktreePrefix } from "@lightfastai/dev-core";

export interface PortRange {
	min?: number | string;
	max?: number | string;
}

export interface NormalizedPortRange {
	min: number;
	max: number;
}

export type ApplicationOverride =
	| string
	| {
			dir?: string;
			path?: string;
			portlessName?: string;
		};

export interface PortlessMfeConfig {
	root?: string;
	configPath?: string;
	portless?: {
		name?: string;
		port?: number | string;
		https?: boolean;
		tld?: string;
	};
	microfrontends?: {
		config?: string;
		apps?: Record<string, ApplicationOverride>;
		proxyPortRange?: PortRange;
	};
	[key: string]: unknown;
}

export interface NormalizedPortlessMfeConfig {
	root: string;
	configPath?: string;
	portless: {
		name: string;
		port: number;
		https: boolean;
		tld: string;
	};
	microfrontends: {
		config: string;
		apps: Record<string, ApplicationOverride>;
		proxyPortRange: NormalizedPortRange;
	};
}

export interface MicrofrontendApplicationConfig {
	packageName?: string;
	development?: Record<string, unknown>;
	[key: string]: unknown;
}

export interface MicrofrontendsSourceConfig {
	applications?: Record<string, MicrofrontendApplicationConfig>;
	options?: Record<string, unknown>;
	[key: string]: unknown;
}

export interface RuntimeIdentity {
	name: string;
	baseName: string;
	targetUrl: string;
	worktreePrefix?: string;
}

export type PortAvailable = (port: number) => boolean | Promise<boolean>;
export type GetPortlessUrl = (
	name: string,
	options?: { cwd?: string; env?: Env; runner?: typeof spawnSync },
) => string | undefined;

export interface LoadPortlessMfeConfigOptions {
	cwd?: string;
	configPath?: string;
}

export interface ResolvePortlessUrlOptions {
	name?: string;
	path?: string;
	targetUrl?: string;
	cwd?: string;
	env?: Env;
	config?: PortlessMfeConfig | NormalizedPortlessMfeConfig;
	configPath?: string;
	getPortlessUrl?: GetPortlessUrl;
	detectWorktreePrefix?: DetectWorktreePrefix;
	preferCurrentPortlessUrl?: boolean;
}

export type ResolveTargetUrlOptions = ResolvePortlessUrlOptions;

export interface ResolveRuntimeIdentityOptions {
	name?: string;
	targetUrl: string;
	appName?: string;
	cwd?: string;
	env?: Env;
	config?: PortlessMfeConfig | NormalizedPortlessMfeConfig;
}

export interface ResolvePortlessMfeRuntimeOptions extends ResolvePortlessUrlOptions {
	appName?: string;
}

export interface ResolvePortlessApplicationUrlOptions extends ResolvePortlessUrlOptions {
	app: string;
	sourceConfig?: MicrofrontendsSourceConfig;
}

export interface GetPortlessMfeDevOriginsOptions {
	name?: string;
	tld?: string;
	cwd?: string;
	env?: Env;
	config?: PortlessMfeConfig | NormalizedPortlessMfeConfig;
	configPath?: string;
	includeWildcard?: boolean;
	includePort?: boolean | "both";
	allowMissingConfig?: boolean;
}

export interface CreateVercelMicrofrontendsDevConfigOptions {
	cwd?: string;
	env?: Env;
	config?: PortlessMfeConfig | NormalizedPortlessMfeConfig;
	sourceConfigPath?: string;
	appDirs?: Record<string, ApplicationOverride>;
	write?: boolean;
	portAvailable?: PortAvailable;
	getPortlessUrl?: GetPortlessUrl;
	detectWorktreePrefix?: DetectWorktreePrefix;
}

export interface VercelMicrofrontendsDevConfigResult {
	host: string;
	localProxyPort: number;
	appUrls: Record<string, string>;
	appBridgePorts: Record<string, number>;
	appDirs: Record<string, string>;
	sourceConfig: MicrofrontendsSourceConfig;
	generatedConfig: MicrofrontendsSourceConfig;
	sourceConfigPath: string;
	generatedConfigPath: string;
	runtimeConfigFilename: string;
	localAppNames: string[];
}

export interface InferLocalAppNamesOptions {
	applications?: Record<string, MicrofrontendApplicationConfig>;
	requestedApps?: string[];
	commandArgs?: string[];
	appDirs?: Record<string, string>;
	cwd?: string;
	root?: string;
	env?: Env;
}

export interface CreateVercelMicrofrontendsDevEnvOptions {
	result: Pick<
		VercelMicrofrontendsDevConfigResult,
		"localProxyPort" | "generatedConfigPath" | "runtimeConfigFilename"
	> & { localAppNames?: string[] };
	localApps?: string[];
	env?: Env;
}

export interface ResolvePortlessHostOptions extends ResolvePortlessUrlOptions {}

export interface WorkspacePackage {
	name: string;
	dir: string;
}

interface NormalizedApplicationOverride {
	dir?: string;
	portlessName?: string;
}

interface NormalizePackageConfigOptions {
	root?: string;
	configPath?: string;
}

interface CommandResult {
	status: number | null;
	stdout?: string;
	stderr?: string;
}

type FallbackCommand = [string, string[]];

const CONFIG_FILENAMES = ["related-projects.json"];
const RUNTIME_CONFIG_FILENAME = "microfrontends.local.json";
const DEFAULT_APP_BRIDGE_PORT_RANGE = { min: 5100, max: 8999 };
const DEFAULT_PROXY_PORT_RANGE = { min: 9000, max: 9999 };
const DEFAULT_PORTLESS_PORT = 1355;
const DEFAULT_PORTLESS_NAME = "mfe";
const DEFAULT_PORTLESS_TLD = "localhost";

const RESERVED_PORTS = new Set([
	0,
	1,
	7,
	9,
	11,
	13,
	15,
	17,
	19,
	20,
	21,
	22,
	23,
	25,
	37,
	42,
	43,
	53,
	69,
	77,
	79,
	87,
	95,
	101,
	102,
	103,
	104,
	109,
	110,
	111,
	113,
	115,
	117,
	119,
	123,
	135,
	137,
	139,
	143,
	161,
	389,
	427,
	443,
	445,
	465,
	500,
	512,
	513,
	514,
	515,
	526,
	530,
	531,
	532,
	540,
	548,
	554,
	556,
	563,
	587,
	601,
	636,
	989,
	990,
	993,
	995,
	1719,
	1720,
	1723,
	2049,
	3659,
	4045,
	4190,
	5060,
	5061,
	6000,
	6566,
	6665,
	6666,
	6667,
	6668,
	6669,
	6679,
	6697,
]);

export async function loadPortlessMfeConfig(
	options: LoadPortlessMfeConfigOptions = {},
): Promise<NormalizedPortlessMfeConfig> {
	return loadPortlessMfeConfigSync(options);
}

export function loadPortlessMfeConfigSync({
	cwd = process.cwd(),
	configPath,
}: LoadPortlessMfeConfigOptions = {}): NormalizedPortlessMfeConfig {
	const resolvedPath = configPath
		? path.resolve(cwd, configPath)
		: findConfigFile(cwd);

	if (!resolvedPath) {
		throw new Error(
			`Could not find ${CONFIG_FILENAMES.join(" or ")} from ${cwd}`,
		);
	}

	const rawConfig = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
	return normalizePackageConfig(rawConfig, {
		configPath: resolvedPath,
		root: path.dirname(resolvedPath),
	});
}

export function resolvePortlessUrl({
	name,
	path: targetPath,
	targetUrl,
	cwd = process.cwd(),
	env = process.env,
	config,
	configPath,
	getPortlessUrl = defaultGetPortlessUrl,
	detectWorktreePrefix = defaultDetectWorktreePrefix,
	preferCurrentPortlessUrl = true,
}: ResolvePortlessUrlOptions = {}): string {
	const normalized = resolveOptionalPackageConfigForApi({ cwd, config, configPath }) ??
		normalizePackageConfig(config ?? {}, { root: cwd });
	const portlessName = name ?? normalized.portless.name;
	const resolvedTargetPath = targetPath ?? "/";

	if (targetUrl) {
		return targetUrl;
	}

	if (
		preferCurrentPortlessUrl &&
		env.PORTLESS_URL &&
		portlessUrlMatchesName(env.PORTLESS_URL, portlessName, env.PORTLESS_TLD || normalized.portless.tld)
	) {
		return withTargetPath(env.PORTLESS_URL, resolvedTargetPath);
	}

	const host = resolvePortlessHost({
		name: portlessName,
		cwd: normalized.root,
		env,
		config: normalized,
		getPortlessUrl,
		detectWorktreePrefix,
		preferCurrentPortlessUrl,
	});

	const protocol = isHttpsEnabled(normalized, env) ? "https" : "http";
	const port = parsePort(env.PORTLESS_PORT) ?? normalized.portless.port;
	const portSuffix = shouldIncludePort(protocol, port) ? `:${port}` : "";
	return withTargetPath(`${protocol}://${host}${portSuffix}`, resolvedTargetPath);
}

export function resolveTargetUrl(options: ResolveTargetUrlOptions = {}): string {
	return resolvePortlessUrl(options);
}

export function resolveRuntimeIdentity({
	name,
	targetUrl,
	appName,
	cwd = process.cwd(),
	env = process.env,
	config,
}: ResolveRuntimeIdentityOptions): RuntimeIdentity {
	const normalized = normalizePackageConfig(config ?? {}, { root: cwd });
	const portlessName = name ?? normalized.portless.name;
	const runtimeBaseName = appName ?? `${portlessName}-desktop`;
	const tld = env.PORTLESS_TLD || normalized.portless.tld;
	const baseHost = `${portlessName}.${tld}`;

	let worktreePrefix;
	try {
		const host = new URL(targetUrl).hostname;
		if (host !== baseHost && host.endsWith(`.${baseHost}`)) {
			const prefix = host.slice(0, -`.${baseHost}`.length);
			worktreePrefix = sanitizeWorktreePrefix(prefix);
		}
	} catch {
		// Non-URL targets use the base runtime name.
	}

	return {
		name: worktreePrefix ? `${runtimeBaseName}-${worktreePrefix}` : runtimeBaseName,
		baseName: runtimeBaseName,
		targetUrl,
		worktreePrefix,
	};
}

export function resolvePortlessMfeUrl({
	name,
	path: targetPath,
	targetUrl,
	cwd = process.cwd(),
	env = process.env,
	config,
	configPath,
	getPortlessUrl = defaultGetPortlessUrl,
	detectWorktreePrefix = defaultDetectWorktreePrefix,
}: ResolvePortlessMfeRuntimeOptions = {}): string {
	const normalized = resolvePackageConfigForApi({ cwd, config, configPath });
	const portlessName = name ?? normalized.portless.name;
	const runtimeEnv = buildPortlessEnv(normalized, env);

	return resolvePortlessUrl({
		name: portlessName,
		path: targetPath,
		targetUrl,
		cwd: normalized.root,
		env: runtimeEnv,
		config: normalized,
		getPortlessUrl,
		detectWorktreePrefix,
	});
}

export function resolvePortlessMfeRuntime({
	name,
	path: targetPath,
	targetUrl,
	appName,
	cwd = process.cwd(),
	env = process.env,
	config,
	configPath,
	getPortlessUrl = defaultGetPortlessUrl,
	detectWorktreePrefix = defaultDetectWorktreePrefix,
}: ResolvePortlessMfeRuntimeOptions = {}): RuntimeIdentity {
	const normalized = resolvePackageConfigForApi({ cwd, config, configPath });
	const portlessName = name ?? normalized.portless.name;
	const runtimeEnv = buildPortlessEnv(normalized, env);
	const resolvedTargetUrl = resolvePortlessUrl({
		name: portlessName,
		path: targetPath,
		targetUrl,
		cwd: normalized.root,
		env: runtimeEnv,
		config: normalized,
		getPortlessUrl,
		detectWorktreePrefix,
	});

	return resolveRuntimeIdentity({
		name: portlessName,
		targetUrl: resolvedTargetUrl,
		appName,
		cwd: normalized.root,
		env: runtimeEnv,
		config: normalized,
	});
}

export function resolvePortlessApplicationUrl({
	app,
	path: targetPath,
	targetUrl,
	cwd = process.cwd(),
	env = process.env,
	config,
	configPath,
	sourceConfig,
	getPortlessUrl = defaultGetPortlessUrl,
	detectWorktreePrefix = defaultDetectWorktreePrefix,
}: ResolvePortlessApplicationUrlOptions): string {
	if (!app) {
		throw new Error("resolvePortlessApplicationUrl requires an app name.");
	}

	const normalized = resolvePackageConfigForApi({ cwd, config, configPath });
	const resolvedSourceConfig = sourceConfig ?? readMicrofrontendsConfig(normalized);
	const applications = resolvedSourceConfig.applications ?? {};
	const appName = resolveRequestedApplicationName(applications, app);

	if (!appName) {
		throw new Error(
			`Unknown app "${app}". Available apps: ${Object.keys(applications).join(", ")}`,
		);
	}

	return resolvePortlessUrl({
		name: resolveApplicationPortlessName(appName, applications[appName], normalized),
		path: targetPath,
		targetUrl,
		cwd: normalized.root,
		env,
		config: normalized,
		getPortlessUrl,
		detectWorktreePrefix,
		preferCurrentPortlessUrl: false,
	});
}

export function getPortlessMfeDevOrigins({
	name,
	tld,
	cwd = process.cwd(),
	env = process.env,
	config,
	configPath,
	includeWildcard = true,
	includePort = false,
	allowMissingConfig = false,
}: GetPortlessMfeDevOriginsOptions = {}): string[] {
	const normalized = resolveOptionalPackageConfigForApi({ cwd, config, configPath });

	if (!normalized && !name) {
		if (allowMissingConfig) {
			return [];
		}

		throw new Error(
			`Could not find ${CONFIG_FILENAMES.join(" or ")} from ${cwd}`,
		);
	}

	const fallbackConfig = normalized ?? normalizePackageConfig({}, { root: cwd });
	const portlessName = name ?? fallbackConfig.portless.name;
	const portlessTld = tld ?? env.PORTLESS_TLD ?? fallbackConfig.portless.tld;
	const portlessPort = parsePort(env.PORTLESS_PORT) ?? fallbackConfig.portless.port;
	const portlessNames = [portlessName];

	if (normalized) {
		const sourceConfig = readMicrofrontendsConfigIfAvailable(normalized);
		const originConfig = {
			...normalized,
			portless: {
				...normalized.portless,
				name: portlessName,
			},
		};
		for (const [appName, appConfig] of Object.entries(sourceConfig?.applications ?? {})) {
			portlessNames.push(resolveApplicationPortlessName(appName, appConfig, originConfig));
		}
	}

	return unique(
		portlessNames.flatMap((value) => {
			const host = `${value}.${portlessTld}`;
			const hosts = includePort === "both"
				? [host, `${host}:${portlessPort}`]
				: [`${host}${includePort ? `:${portlessPort}` : ""}`];

			return hosts.flatMap((originHost) => (
				includeWildcard ? [originHost, `*.${originHost}`] : [originHost]
			));
		}),
	);
}

export async function createVercelMicrofrontendsDevConfig({
	cwd = process.cwd(),
	env = process.env,
	config,
	sourceConfigPath,
	appDirs,
	write = true,
	portAvailable = isPortAvailable,
	getPortlessUrl = defaultGetPortlessUrl,
	detectWorktreePrefix = defaultDetectWorktreePrefix,
}: CreateVercelMicrofrontendsDevConfigOptions = {}): Promise<VercelMicrofrontendsDevConfigResult> {
	const normalized = normalizePackageConfig(config ?? {}, { root: cwd });
	const mfeConfigOptions = normalized.microfrontends;
	const sourcePath = path.resolve(
		normalized.root,
		sourceConfigPath ?? mfeConfigOptions.config,
	);
	const generatedPath = path.join(path.dirname(sourcePath), RUNTIME_CONFIG_FILENAME);
	const sourceConfig = JSON.parse(fs.readFileSync(sourcePath, "utf8")) as MicrofrontendsSourceConfig;
	const host = resolvePortlessHost({
		name: normalized.portless.name,
		cwd: normalized.root,
		env,
		config: normalized,
		getPortlessUrl,
		detectWorktreePrefix,
	});
	const localProxyPort = await resolveLocalProxyPort(host, {
		env,
		range: mfeConfigOptions.proxyPortRange,
		portAvailable,
	});
	const applications = sourceConfig.applications ?? {};
	const resolvedAppDirs = resolveApplicationDirectories({
		root: normalized.root,
		applications,
		overrides: appDirs ?? mfeConfigOptions.apps,
	});
	const appUrls = Object.fromEntries(
		Object.entries(applications).map(([appName, appConfig]) => [
			appName,
			resolvePortlessUrl({
				name: resolveApplicationPortlessName(appName, appConfig, normalized),
				cwd: normalized.root,
				env,
				config: normalized,
				getPortlessUrl,
				detectWorktreePrefix,
				preferCurrentPortlessUrl: false,
			}),
		]),
	);
	const appBridgePorts: Record<string, number> = {};
	const usedPorts = new Set([localProxyPort]);
	for (const appName of Object.keys(applications)) {
		const port = await choosePort(`${host}:${appName}:bridge`, {
			min: DEFAULT_APP_BRIDGE_PORT_RANGE.min,
			max: DEFAULT_APP_BRIDGE_PORT_RANGE.max,
			usedPorts,
			portAvailable,
		});
		usedPorts.add(port);
		appBridgePorts[appName] = port;
	}

	const generatedConfig = {
		...sourceConfig,
		options: {
			...(sourceConfig.options ?? {}),
			localProxyPort,
		},
		applications: Object.fromEntries(
			Object.entries(applications).map(([appName, appConfig]) => {
				const runtimeAppConfig = {
					...appConfig,
					development: {
						...(appConfig.development ?? {}),
						local: appBridgePorts[appName],
					},
				};
				return [
					appName,
					addLocalAssetPrefixRoute(appName, runtimeAppConfig),
				];
			}),
		),
	};

	if (write) {
		fs.mkdirSync(path.dirname(generatedPath), { recursive: true });
		const tmpPath = `${generatedPath}.tmp`;
		fs.writeFileSync(tmpPath, `${JSON.stringify(generatedConfig, null, 2)}\n`);
		fs.renameSync(tmpPath, generatedPath);
	}

	return {
		host,
		localProxyPort,
		appUrls,
		appBridgePorts,
		appDirs: resolvedAppDirs,
		sourceConfig,
		generatedConfig,
		sourceConfigPath: sourcePath,
		generatedConfigPath: generatedPath,
		runtimeConfigFilename: RUNTIME_CONFIG_FILENAME,
		localAppNames: Object.keys(applications),
	};
}

function addLocalAssetPrefixRoute(
	appName: string,
	appConfig: MicrofrontendApplicationConfig,
): MicrofrontendApplicationConfig {
	const routing = appConfig.routing;
	if (!Array.isArray(routing) || routing.length === 0) {
		return appConfig;
	}

	const assetPrefix =
		typeof appConfig.assetPrefix === "string"
			? appConfig.assetPrefix
			: generateDefaultAssetPrefix(appName);
	const assetPath = `/${assetPrefix}/:path*`;
	if (
		routing.some((group) =>
			isRoutingGroup(group) &&
			group.paths.some((routePath) => routePath === assetPath)
		)
	) {
		return appConfig;
	}

	const [firstGroup, ...restGroups] = routing;
	if (!isRoutingGroup(firstGroup)) {
		return appConfig;
	}

	return {
		...appConfig,
		routing: [
			{
				...firstGroup,
				paths: [...firstGroup.paths, assetPath],
			},
			...restGroups,
		],
	};
}

function isRoutingGroup(
	value: unknown,
): value is { paths: string[]; [key: string]: unknown } {
	return Boolean(
		value &&
		typeof value === "object" &&
		Array.isArray((value as { paths?: unknown }).paths) &&
		(value as { paths: unknown[] }).paths.every(
			(pathValue) => typeof pathValue === "string",
		),
	);
}

function generateDefaultAssetPrefix(appName: string): string {
	return `vc-ap-${crypto
		.createHash("md5")
		.update(appName)
		.digest("hex")
		.slice(0, 6)
		.padStart(6, "0")}`;
}

export function normalizePackageConfig(
	rawConfig: PortlessMfeConfig | NormalizedPortlessMfeConfig = {},
	{ root = process.cwd(), configPath }: NormalizePackageConfigOptions = {},
): NormalizedPortlessMfeConfig {
	const portless = rawConfig?.portless ?? {};
	const microfrontends = rawConfig?.microfrontends ?? {};

	return {
		root,
		configPath,
		portless: {
			name: portless.name ?? DEFAULT_PORTLESS_NAME,
			port: parsePort(portless.port) ?? DEFAULT_PORTLESS_PORT,
			https: Boolean(portless.https),
			tld: portless.tld ?? DEFAULT_PORTLESS_TLD,
		},
		microfrontends: {
			config: microfrontends.config ?? "microfrontends.json",
			apps: microfrontends.apps ?? {},
			proxyPortRange: {
				min: parsePort(microfrontends.proxyPortRange?.min) ?? DEFAULT_PROXY_PORT_RANGE.min,
				max: parsePort(microfrontends.proxyPortRange?.max) ?? DEFAULT_PROXY_PORT_RANGE.max,
			},
		},
	};
}

export function selectLocalAppNames(
	applications: Record<string, MicrofrontendApplicationConfig> = {},
	requestedApps: string[] = [],
): string[] {
	const allAppNames = Object.keys(applications ?? {});
	const requested = requestedApps.filter(Boolean);

	if (!requested.length) {
		return allAppNames;
	}

	const selected: string[] = [];
	const unknownApps: string[] = [];

	for (const requestedApp of requested) {
		const appName = resolveRequestedApplicationName(applications, requestedApp);
		if (!appName) {
			unknownApps.push(requestedApp);
			continue;
		}

		if (!selected.includes(appName)) {
			selected.push(appName);
		}
	}

	if (unknownApps.length) {
		throw new Error(
			`Unknown local app(s): ${unknownApps.join(", ")}. Available apps: ${allAppNames.join(", ")}`,
		);
	}

	return selected;
}

export function inferLocalAppNames({
	applications,
	requestedApps = [],
	commandArgs = [],
	appDirs = {},
	cwd = process.cwd(),
	root = process.cwd(),
	env = process.env,
}: InferLocalAppNamesOptions = {}): string[] {
	const envApps = parseList(env.PORTLESS_MFE_LOCAL_APPS);
	const explicitApps = requestedApps.length ? requestedApps : envApps;

	if (explicitApps.length) {
		return selectLocalAppNames(applications, explicitApps);
	}

	const filteredApps = extractCommandFilters(commandArgs)
		.map((filter) => resolveFilterToApplicationName(filter, { appDirs, root }) ?? filter);
	if (filteredApps.length) {
		return selectLocalAppNames(applications, filteredApps);
	}

	const cwdApp = resolveCwdApplicationName({ appDirs, cwd });
	if (cwdApp) {
		return [cwdApp];
	}

	return selectLocalAppNames(applications);
}

export function createVercelMicrofrontendsDevEnv({
	result,
	localApps = result?.localAppNames ?? [],
	env = process.env,
}: CreateVercelMicrofrontendsDevEnvOptions): Env {
	if (!result) {
		throw new Error("createVercelMicrofrontendsDevEnv requires a generated dev config result.");
	}

	return {
		...env,
		MFE_LOCAL_PROXY_PORT: String(result.localProxyPort),
		MFE_DISABLE_LOCAL_PROXY_REWRITE: env.MFE_DISABLE_LOCAL_PROXY_REWRITE ?? "1",
		PORTLESS_MFE_LOCAL_APPS: localApps.join(","),
		VC_MICROFRONTENDS_CONFIG: result.generatedConfigPath,
		VC_MICROFRONTENDS_CONFIG_FILE_NAME: result.runtimeConfigFilename,
	};
}

export function addTurboDevEnvMode(commandArgs: string[]): string[] {
	if (!hasTurboRunCommand(commandArgs) || hasTurboEnvMode(commandArgs) || !hasTurboDevTask(commandArgs)) {
		return commandArgs;
	}

	const runIndex = commandArgs.indexOf("run");
	return [
		...commandArgs.slice(0, runIndex + 1),
		"--env-mode=loose",
		...commandArgs.slice(runIndex + 1),
	];
}

export function extractCommandFilters(commandArgs: string[] = []): string[] {
	const filters: string[] = [];

	for (let i = 0; i < commandArgs.length; i++) {
		const arg = commandArgs[i];

		if (arg === "--filter" || arg === "-F") {
			const selector = normalizeFilterSelector(commandArgs[++i]);
			if (selector) {
				filters.push(selector);
			}
			continue;
		}

		if (arg.startsWith("--filter=")) {
			const selector = normalizeFilterSelector(arg.slice("--filter=".length));
			if (selector) {
				filters.push(selector);
			}
			continue;
		}

		if (arg.startsWith("-F=")) {
			const selector = normalizeFilterSelector(arg.slice("-F=".length));
			if (selector) {
				filters.push(selector);
			}
		}
	}

	return filters;
}

export function resolvePortlessHost({
	name,
	cwd = process.cwd(),
	env = process.env,
	config,
	getPortlessUrl = defaultGetPortlessUrl,
	detectWorktreePrefix = defaultDetectWorktreePrefix,
	preferCurrentPortlessUrl = true,
}: ResolvePortlessHostOptions = {}): string {
	const normalized = normalizePackageConfig(config ?? {}, { root: cwd });
	const portlessName = name ?? normalized.portless.name;
	const tld = env.PORTLESS_TLD || normalized.portless.tld;
	const currentUrl =
		preferCurrentPortlessUrl &&
		env.PORTLESS_URL &&
		portlessUrlMatchesName(env.PORTLESS_URL, portlessName, tld)
			? env.PORTLESS_URL
			: undefined;
	const url = currentUrl || getPortlessUrl(portlessName, { cwd, env });

	if (url) {
		try {
			return new URL(url).hostname;
		} catch {
			// Fall through to git-derived host construction.
		}
	}

	const prefix = detectWorktreePrefix(cwd);
	const effectiveName = prefix ? `${prefix}.${portlessName}` : portlessName;
	return `${effectiveName}.${tld}`;
}

export function resolveApplicationDirectories({
	root,
	applications,
	overrides = {},
}: {
	root: string;
	applications: Record<string, MicrofrontendApplicationConfig>;
	overrides?: Record<string, ApplicationOverride>;
}): Record<string, string> {
	const workspacePackages = discoverWorkspacePackages(root);
	const byName = new Map<string, string>();
	const byShortName = new Map<string, string>();

	for (const pkg of workspacePackages) {
		byName.set(pkg.name, pkg.dir);
		byShortName.set(packageShortName(pkg.name), pkg.dir);
	}

	return Object.fromEntries(
		Object.entries(applications).flatMap(([appName, appConfig]) => {
			const override = normalizeApplicationOverride(overrides[appName]);
			if (override.dir) {
				return [[appName, path.resolve(root, override.dir)]];
			}

			const packageName = appConfig.packageName ?? appName;
			const dir = byName.get(packageName) ?? byShortName.get(packageName);
			return dir ? [[appName, dir]] : [];
		}),
	);
}

export function discoverWorkspacePackages(root: string): WorkspacePackage[] {
	const patterns = discoverWorkspacePatterns(root);
	const packages: WorkspacePackage[] = [];

	for (const pattern of patterns) {
		for (const dir of expandWorkspacePattern(root, pattern)) {
			const packageJsonPath = path.join(dir, "package.json");
			if (!fs.existsSync(packageJsonPath)) {
				continue;
			}

			const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
			if (pkg.name) {
				packages.push({ name: pkg.name, dir });
			}
		}
	}

	return packages;
}

export async function resolveLocalProxyPort(
	host: string,
	{
		env = process.env,
		range,
		portAvailable = isPortAvailable,
	}: { env?: Env; range?: NormalizedPortRange; portAvailable?: PortAvailable } = {},
): Promise<number> {
	const explicitPort = parsePort(env.PORT) ?? parsePort(env.MFE_LOCAL_PROXY_PORT);
	if (explicitPort) {
		return explicitPort;
	}

	const proxyRange = range ?? DEFAULT_PROXY_PORT_RANGE;
	return choosePort(`${host}:proxy`, {
		min: proxyRange.min,
		max: proxyRange.max,
		usedPorts: new Set(),
		portAvailable,
	});
}

export async function choosePort(
	seed: string,
	{
		min,
		max,
		usedPorts = new Set<number>(),
		portAvailable = isPortAvailable,
	}: {
		min: number;
		max: number;
		usedPorts?: Set<number>;
		portAvailable?: PortAvailable;
	},
): Promise<number> {
	if (min > max) {
		throw new Error(`Invalid port range ${min}-${max}`);
	}

	const size = max - min + 1;
	const offset = positiveHash(seed) % size;

	for (let i = 0; i < size; i++) {
		const port = min + ((offset + i) % size);
		if (RESERVED_PORTS.has(port) || usedPorts.has(port)) {
			continue;
		}

		if (await portAvailable(port)) {
			return port;
		}
	}

	throw new Error(`No available port found in range ${min}-${max} for ${seed}`);
}

export function withTargetPath(baseUrl: string, targetPath: string = "/"): string {
	if (targetPath === "" || targetPath === undefined || targetPath === null) {
		return new URL(baseUrl).toString();
	}

	const normalizedPath = String(targetPath).startsWith("/")
		? String(targetPath)
		: `/${targetPath}`;
	return new URL(normalizedPath, baseUrl).toString();
}

export function buildPortlessEnv(
	config: PortlessMfeConfig | NormalizedPortlessMfeConfig,
	env: Env = process.env,
): Env {
	const normalized = normalizePackageConfig(config ?? {}, { root: process.cwd() });
	return {
		...env,
		PORTLESS_PORT: String(parsePort(env.PORTLESS_PORT) ?? normalized.portless.port),
		PORTLESS_HTTPS: env.PORTLESS_HTTPS ?? (normalized.portless.https ? "1" : "0"),
		...(env.PORTLESS_TLD ? {} : { PORTLESS_TLD: normalized.portless.tld }),
	};
}

export function startPortlessProxy({
	config,
	cwd = process.cwd(),
	env = process.env,
	runner = spawnSync,
}: {
	config?: PortlessMfeConfig | NormalizedPortlessMfeConfig;
	cwd?: string;
	env?: Env;
	runner?: typeof spawnSync;
} = {}): { env: Env; port: number; https: boolean } {
	const normalized = normalizePackageConfig(config ?? {}, { root: cwd });
	const portlessEnv = buildPortlessEnv(normalized, env);
	const port = parsePort(portlessEnv.PORTLESS_PORT) ?? normalized.portless.port;
	const https = portlessEnv.PORTLESS_HTTPS !== "0";
	const args = ["proxy", "start", "--port", String(port), https ? "--https" : "--no-tls"];
	const result = runWithFallbackCommands({
		commands: [
			["portless", args],
			["pnpm", ["exec", "portless", ...args]],
		],
		cwd: normalized.root,
		env: portlessEnv,
		runner,
		stdio: "inherit",
	});

	if (result.status !== 0) {
		throw new Error(`Failed to start Portless proxy on port ${port}`);
	}

	return { env: portlessEnv, port, https };
}

export function defaultGetPortlessUrl(
	name: string,
	{ cwd = process.cwd(), env = process.env, runner = spawnSync }: {
		cwd?: string;
		env?: Env;
		runner?: typeof spawnSync;
	} = {},
): string | undefined {
	const result = runWithFallbackCommands({
		commands: [
			["portless", ["get", name]],
			["pnpm", ["exec", "portless", "get", name]],
		],
		cwd,
		env,
		runner,
		stdio: ["ignore", "pipe", "ignore"],
	});

	if (result.status === 0 && result.stdout?.trim()) {
		return result.stdout.trim();
	}

	return undefined;
}

function runWithFallbackCommands({
	commands,
	cwd,
	env,
	runner,
	stdio,
}: {
	commands: FallbackCommand[];
	cwd: string;
	env: Env;
	runner: typeof spawnSync;
	stdio: StdioOptions;
}): CommandResult {
	let lastResult: CommandResult = { status: 1, stdout: "", stderr: "" };

	for (const [command, args] of commands) {
		const result = runner(command, args, {
			cwd,
			env,
			encoding: "utf8",
			stdio,
		});
		lastResult = result;

		if (result.status === 0) {
			return result;
		}
	}

	return lastResult;
}

export function resolveApplicationPortlessName(
	appName: string,
	appConfig: MicrofrontendApplicationConfig = {},
	config: PortlessMfeConfig | NormalizedPortlessMfeConfig = {},
): string {
	const normalized = normalizePackageConfig(config, { root: config.root ?? process.cwd() });
	const override = normalizeApplicationOverride(normalized.microfrontends.apps?.[appName]);
	if (override.portlessName) {
		return normalizePortlessName(override.portlessName);
	}

	const packageName = appConfig.packageName ?? appName;
	const shortName = packageShortName(packageName);
	return normalizePortlessName(`${shortName}.${normalized.portless.name}`);
}

function readMicrofrontendsConfig(
	config: PortlessMfeConfig | NormalizedPortlessMfeConfig,
): MicrofrontendsSourceConfig {
	const normalized = normalizePackageConfig(config, { root: config.root ?? process.cwd() });
	const sourcePath = path.resolve(normalized.root, normalized.microfrontends.config);
	return JSON.parse(fs.readFileSync(sourcePath, "utf8"));
}

function readMicrofrontendsConfigIfAvailable(
	config: PortlessMfeConfig | NormalizedPortlessMfeConfig,
): MicrofrontendsSourceConfig | undefined {
	try {
		return readMicrofrontendsConfig(config);
	} catch {
		return undefined;
	}
}

function normalizeApplicationOverride(value: ApplicationOverride | unknown): NormalizedApplicationOverride {
	if (!value) {
		return {};
	}
	if (typeof value === "string") {
		return { dir: value };
	}
	if (typeof value === "object" && !Array.isArray(value)) {
		const override = value as { dir?: string; path?: string; portlessName?: string };
		return {
			dir: override.dir ?? override.path,
			portlessName: override.portlessName,
		};
	}
	return {};
}

function normalizePortlessName(value: string): string {
	return String(value)
		.split(".")
		.map((label) => sanitizeHostnameLabels(label))
		.filter(Boolean)
		.join(".");
}

function portlessUrlMatchesName(url: string, name: string, tld: string): boolean {
	try {
		const host = new URL(url).hostname;
		const baseHost = `${name}.${tld}`;
		return host === baseHost || host.endsWith(`.${baseHost}`);
	} catch {
		return false;
	}
}

function unique<T>(values: Array<T | undefined | null | false | "">): T[] {
	return Array.from(new Set(values.filter((value): value is T => Boolean(value))));
}

function resolvePackageConfigForApi({
	cwd,
	config,
	configPath,
}: {
	cwd: string;
	config?: PortlessMfeConfig | NormalizedPortlessMfeConfig;
	configPath?: string;
}): NormalizedPortlessMfeConfig {
	const normalized = resolveOptionalPackageConfigForApi({ cwd, config, configPath });
	if (normalized) {
		return normalized;
	}

	throw new Error(
		`Could not find ${CONFIG_FILENAMES.join(" or ")} from ${cwd}`,
	);
}

function resolveOptionalPackageConfigForApi({
	cwd,
	config,
	configPath,
}: {
	cwd: string;
	config?: PortlessMfeConfig | NormalizedPortlessMfeConfig;
	configPath?: string;
}): NormalizedPortlessMfeConfig | undefined {
	if (config) {
		return normalizePackageConfig(config, {
			root: config.root ?? cwd,
			configPath: config.configPath ?? configPath,
		});
	}

	const resolvedPath = configPath
		? path.resolve(cwd, configPath)
		: findConfigFile(cwd);
	if (!resolvedPath) {
		return undefined;
	}

	const rawConfig = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
	return normalizePackageConfig(rawConfig, {
		configPath: resolvedPath,
		root: path.dirname(resolvedPath),
	});
}

function findConfigFile(cwd: string): string | undefined {
	let dir = path.resolve(cwd);

	for (;;) {
		for (const filename of CONFIG_FILENAMES) {
			const maybeConfig = path.join(dir, filename);
			if (fs.existsSync(maybeConfig)) {
				return maybeConfig;
			}
		}

		const parent = path.dirname(dir);
		if (parent === dir) {
			return undefined;
		}
		dir = parent;
	}
}

function discoverWorkspacePatterns(root: string): string[] {
	const pnpmWorkspacePath = path.join(root, "pnpm-workspace.yaml");
	if (fs.existsSync(pnpmWorkspacePath)) {
		const patterns = parsePnpmWorkspacePackages(
			fs.readFileSync(pnpmWorkspacePath, "utf8"),
		);
		if (patterns.length) {
			return patterns;
		}
	}

	const packageJsonPath = path.join(root, "package.json");
	if (!fs.existsSync(packageJsonPath)) {
		return [];
	}

	const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
	if (Array.isArray(pkg.workspaces)) {
		return pkg.workspaces;
	}
	if (Array.isArray(pkg.workspaces?.packages)) {
		return pkg.workspaces.packages;
	}

	return [];
}

function parsePnpmWorkspacePackages(contents: string): string[] {
	const patterns: string[] = [];
	let inPackages = false;

	for (const line of contents.split(/\r?\n/)) {
		if (/^\S/.test(line)) {
			inPackages = line.trim() === "packages:";
			continue;
		}

		if (!inPackages) {
			continue;
		}

		const match = line.match(/^\s*-\s*["']?([^"']+)["']?\s*$/);
		if (match) {
			patterns.push(match[1]);
		}
	}

	return patterns;
}

function expandWorkspacePattern(root: string, pattern: string): string[] {
	if (pattern.startsWith("!")) {
		return [];
	}

	if (!pattern.includes("*")) {
		const dir = path.resolve(root, pattern);
		return fs.existsSync(dir) ? [dir] : [];
	}

	const [prefix] = pattern.split("*", 1);
	const base = path.resolve(root, prefix);
	if (!fs.existsSync(base)) {
		return [];
	}

	return fs
		.readdirSync(base, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => path.join(base, entry.name));
}

function resolveRequestedApplicationName(
	applications: Record<string, MicrofrontendApplicationConfig> = {},
	requestedApp?: string,
): string | undefined {
	if (!requestedApp) {
		return undefined;
	}

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

function resolveFilterToApplicationName(
	filter: string,
	{ appDirs = {}, root = process.cwd() }: { appDirs?: Record<string, string>; root?: string } = {},
): string | undefined {
	if (!filter.includes("/") && !filter.startsWith(".")) {
		return undefined;
	}

	const resolvedFilter = path.resolve(root, filter);
	for (const [appName, appDir] of Object.entries(appDirs)) {
		if (resolvedFilter === path.resolve(appDir)) {
			return appName;
		}
	}

	return undefined;
}

function resolveCwdApplicationName({
	appDirs = {},
	cwd = process.cwd(),
}: { appDirs?: Record<string, string>; cwd?: string } = {}): string | undefined {
	const resolvedCwd = path.resolve(cwd);
	const matches = Object.entries(appDirs)
		.filter(([, appDir]) => isPathInside(resolvedCwd, path.resolve(appDir)))
		.sort(([, left], [, right]) => right.length - left.length);
	return matches[0]?.[0];
}

function isPathInside(child: string, parent: string): boolean {
	const relative = path.relative(parent, child);
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function parseList(value: string | undefined): string[] {
	return String(value ?? "")
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
}

function normalizeFilterSelector(value: string | undefined): string | undefined {
	if (!value) {
		return undefined;
	}

	let selector = String(value).trim();
	if (!selector || selector.startsWith("!")) {
		return undefined;
	}

	selector = selector.replace(/\[[^\]]+\]$/, "");
	while (selector.startsWith("...")) {
		selector = selector.slice(3);
	}
	while (selector.endsWith("...")) {
		selector = selector.slice(0, -3);
	}

	return selector || undefined;
}

function hasTurboRunCommand(commandArgs: string[] = []): boolean {
	if (!commandArgs.length) {
		return false;
	}

	const command = path.basename(commandArgs[0]);
	if (command === "turbo" && commandArgs.includes("run")) {
		return true;
	}

	return command === "pnpm" &&
		commandArgs[1] === "exec" &&
		commandArgs[2] === "turbo" &&
		commandArgs.includes("run");
}

function hasTurboEnvMode(commandArgs: string[] = []): boolean {
	return commandArgs.some((arg) => arg === "--env-mode" || arg.startsWith("--env-mode="));
}

function hasTurboDevTask(commandArgs: string[] = []): boolean {
	const runIndex = commandArgs.indexOf("run");
	if (runIndex === -1) {
		return false;
	}

	for (let i = runIndex + 1; i < commandArgs.length; i++) {
		const arg = commandArgs[i];
		if (arg === "--") {
			continue;
		}
		if (arg.startsWith("--")) {
			if (!arg.includes("=") && commandArgs[i + 1] && !commandArgs[i + 1].startsWith("-")) {
				i++;
			}
			continue;
		}
		if (arg.startsWith("-")) {
			if (!arg.includes("=") && commandArgs[i + 1] && !commandArgs[i + 1].startsWith("-")) {
				i++;
			}
			continue;
		}

		if (arg === "dev" || arg.startsWith("dev:")) {
			return true;
		}
	}

	return false;
}

function isHttpsEnabled(config: NormalizedPortlessMfeConfig, env: Env): boolean {
	if (env.PORTLESS_HTTPS !== undefined) {
		return env.PORTLESS_HTTPS !== "0" && env.PORTLESS_HTTPS !== "false";
	}
	return Boolean(config.portless.https);
}

function shouldIncludePort(protocol: string, port: number | undefined): boolean {
	return Boolean(port) && !((protocol === "https" && port === 443) || (protocol === "http" && port === 80));
}

function sanitizeHostnameLabels(value: string): string {
	return value
		.split(".")
		.join("-")
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.replace(/--+/g, "-");
}

function packageShortName(name: string): string {
	return name.split("/").pop() ?? name;
}

function positiveHash(value: string): number {
	let hash = 0;
	for (let i = 0; i < value.length; i++) {
		hash = (hash << 5) - hash + value.charCodeAt(i);
		hash |= 0;
	}
	return Math.abs(hash);
}

function parsePort(value: string | number | undefined | null): number | undefined {
	if (value === undefined || value === null || value === "") {
		return undefined;
	}

	const port = Number.parseInt(String(value), 10);
	return Number.isInteger(port) && port > 0 && port < 65536 ? port : undefined;
}

function isPortAvailable(port: number): Promise<boolean> {
	return new Promise<boolean>((resolve) => {
		const server = net.createServer();

		server.once("error", () => resolve(false));
		server.once("listening", () => {
			server.close(() => resolve(true));
		});
		server.listen(port, "127.0.0.1");
	});
}
