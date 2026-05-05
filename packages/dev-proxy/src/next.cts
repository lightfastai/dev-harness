const fs = require("node:fs");
const path = require("node:path");

const CONFIG_FILENAMES = ["lightfast.dev.json"];
const DEFAULT_PORTLESS_NAME = "mfe";
const DEFAULT_PORTLESS_TLD = "localhost";
const DEFAULT_PORTLESS_PORT = 1355;
const DEFAULT_MFE_CONFIG = "microfrontends.json";

type Env = Record<string, string | undefined>;
type ApplicationConfig = {
	packageName?: string;
	[key: string]: any;
};
type PackageConfig = {
	root?: string;
	configPath?: string;
	portless?: {
		name?: string;
		port?: number | string;
		tld?: string;
	};
	microfrontends?: {
		config?: string;
		apps?: Record<string, unknown>;
	};
};
type NextConfig = {
	allowedDevOrigins?: string[];
	experimental?: {
		serverActions?: {
			allowedOrigins?: string[];
			[key: string]: any;
		};
		[key: string]: any;
	};
	[key: string]: any;
};
type OriginsOptions = {
	name?: string;
	tld?: string;
	cwd?: string;
	env?: Env;
	config?: PackageConfig;
	configPath?: string;
	includeWildcard?: boolean;
	includePort?: boolean | "both";
	allowMissingConfig?: boolean;
	origins?: string[];
	serverActions?: boolean | { includePort?: boolean | "both" };
};

function withPortlessProxy<T extends NextConfig>(
	nextConfig: T = {} as T,
	options: OriginsOptions = {},
): T {
	const { serverActions, origins: providedOrigins, ...originOptions } = options;

	const devOrigins = providedOrigins ?? getPortlessProxyOrigins({
		...originOptions,
		allowMissingConfig: true,
	});

	if (!devOrigins.length) {
		return nextConfig;
	}

	const next: T = {
		...nextConfig,
		allowedDevOrigins: unique([
			...(nextConfig.allowedDevOrigins ?? []),
			...devOrigins,
		]),
	} as T;

	if (serverActions) {
		const includePort = typeof serverActions === "object" ? serverActions.includePort : false;
		const serverActionOrigins = providedOrigins ?? getPortlessProxyOrigins({
			...originOptions,
			allowMissingConfig: true,
			includePort,
		});

		next.experimental = {
			...nextConfig.experimental,
			serverActions: {
				...nextConfig.experimental?.serverActions,
				allowedOrigins: unique([
					...(nextConfig.experimental?.serverActions?.allowedOrigins ?? []),
					...serverActionOrigins,
				]),
			},
		};
	}

	return next;
}

function getPortlessProxyOrigins({
	name,
	tld,
	cwd = process.cwd(),
	env = process.env,
	config,
	configPath,
	includeWildcard = true,
	includePort = false,
	allowMissingConfig = false,
}: OriginsOptions = {}): string[] {
	const normalized = resolveOptionalPackageConfig({ cwd, config, configPath });

	if (!normalized && !name) {
		if (allowMissingConfig) {
			return [];
		}

		throw new Error(
			`Could not find ${CONFIG_FILENAMES.join(" or ")} from ${cwd}`,
		);
	}

	const portless = normalized?.portless ?? {};
	const microfrontends = normalized?.microfrontends ?? {};
	const portlessName = name ?? portless.name ?? DEFAULT_PORTLESS_NAME;
	const portlessTld = tld ?? env.PORTLESS_TLD ?? portless.tld ?? DEFAULT_PORTLESS_TLD;
	const portlessPort = parsePort(env.PORTLESS_PORT) ?? parsePort(portless.port) ?? DEFAULT_PORTLESS_PORT;
	const portlessNames = [portlessName];

	if (normalized) {
		const originConfig = {
			...normalized,
			portless: {
				...normalized.portless,
				name: portlessName,
			},
		};
		const sourceConfig = readMicrofrontendsConfigIfAvailable({
			root: normalized.root ?? cwd,
			microfrontends,
			portless: { name: portlessName },
		});
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

function parsePort(value: string | number | undefined | null): number | undefined {
	if (value === undefined || value === null || value === "") {
		return undefined;
	}
	const port = Number(value);
	if (!Number.isInteger(port) || port <= 0 || port > 65535) {
		return undefined;
	}
	return port;
}

function resolveOptionalPackageConfig({
	cwd,
	config,
	configPath,
}: {
	cwd: string;
	config?: PackageConfig;
	configPath?: string;
}): PackageConfig | undefined {
	if (config) {
		return config;
	}

	const resolvedPath = configPath
		? path.resolve(cwd, configPath)
		: findConfigFile(cwd);
	if (!resolvedPath) {
		return undefined;
	}

	return {
		...JSON.parse(fs.readFileSync(resolvedPath, "utf8")),
		root: path.dirname(resolvedPath),
		configPath: resolvedPath,
	};
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

function readMicrofrontendsConfigIfAvailable(config: PackageConfig): { applications?: Record<string, ApplicationConfig> } | undefined {
	try {
		const sourcePath = path.resolve(
			config.root ?? process.cwd(),
			config.microfrontends?.config ?? DEFAULT_MFE_CONFIG,
		);
		return JSON.parse(fs.readFileSync(sourcePath, "utf8"));
	} catch {
		return undefined;
	}
}

function resolveApplicationPortlessName(
	appName: string,
	appConfig: ApplicationConfig = {},
	config: PackageConfig = {},
): string {
	const override = normalizeApplicationOverride(config.microfrontends?.apps?.[appName]);
	if (override.portlessName) {
		return normalizePortlessName(override.portlessName);
	}

	const packageName = appConfig.packageName ?? appName;
	return normalizePortlessName(`${packageShortName(packageName)}.${config.portless?.name ?? DEFAULT_PORTLESS_NAME}`);
}

function normalizeApplicationOverride(value: unknown): { dir?: string; portlessName?: string } {
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

function unique<T>(values: Array<T | undefined | null | false | "">): T[] {
	return Array.from(new Set(values.filter((value): value is T => Boolean(value))));
}

module.exports = {
	getPortlessProxyOrigins,
	withPortlessProxy,
};
