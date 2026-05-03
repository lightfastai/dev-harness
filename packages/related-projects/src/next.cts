const fs = require("node:fs");
const path = require("node:path");

const CONFIG_FILENAMES = ["related-projects.json"];
const DEFAULT_PORTLESS_NAME = "mfe";
const DEFAULT_PORTLESS_TLD = "localhost";
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
		tld?: string;
	};
	microfrontends?: {
		config?: string;
		apps?: Record<string, unknown>;
	};
};
type NextConfig = {
	allowedDevOrigins?: string[];
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
	allowMissingConfig?: boolean;
	origins?: string[];
};

function withPortlessMfeDev<T extends NextConfig>(
	nextConfig: T = {} as T,
	options: OriginsOptions = {},
): T {
	const origins = options.origins ?? getPortlessMfeDevOrigins({
		...options,
		allowMissingConfig: true,
	});

	if (!origins.length) {
		return nextConfig;
	}

	return {
		...nextConfig,
		allowedDevOrigins: unique([
			...(nextConfig.allowedDevOrigins ?? []),
			...origins,
		]),
	} as T;
}

function getPortlessMfeDevOrigins({
	name,
	tld,
	cwd = process.cwd(),
	env = process.env,
	config,
	configPath,
	includeWildcard = true,
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
			return includeWildcard ? [host, `*.${host}`] : [host];
		}),
	);
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
	getPortlessMfeDevOrigins,
	withPortlessMfeDev,
};
