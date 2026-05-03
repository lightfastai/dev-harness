const fs = require("node:fs");
const path = require("node:path");

const CONFIG_FILENAMES = ["portless-mfe.config.json"];
const DEFAULT_PORTLESS_NAME = "mfe";
const DEFAULT_PORTLESS_TLD = "localhost";

function withPortlessMfeDev(nextConfig = {}, options = {}) {
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
	};
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
} = {}) {
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
	const portlessName = name ?? portless.name ?? DEFAULT_PORTLESS_NAME;
	const portlessTld = tld ?? env.PORTLESS_TLD ?? portless.tld ?? DEFAULT_PORTLESS_TLD;
	const baseHost = `${portlessName}.${portlessTld}`;

	return includeWildcard ? [baseHost, `*.${baseHost}`] : [baseHost];
}

function resolveOptionalPackageConfig({ cwd, config, configPath }) {
	if (config) {
		return config;
	}

	const resolvedPath = configPath
		? path.resolve(cwd, configPath)
		: findConfigFile(cwd);
	if (!resolvedPath) {
		return undefined;
	}

	return JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
}

function findConfigFile(cwd) {
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

function unique(values) {
	return Array.from(new Set(values.filter(Boolean)));
}

module.exports = {
	getPortlessMfeDevOrigins,
	withPortlessMfeDev,
};
