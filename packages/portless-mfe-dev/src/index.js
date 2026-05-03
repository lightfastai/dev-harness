import { spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

const CONFIG_FILENAMES = ["portless-mfe.config.json"];
const RUNTIME_CONFIG_FILENAME = "microfrontends.local.json";
const DEFAULT_APP_PORT_RANGE = { min: 5100, max: 8999 };
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

export async function loadPortlessMfeConfig({ cwd = process.cwd(), configPath } = {}) {
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

export function resolveTargetUrl({
	name,
	path: targetPath,
	targetUrl,
	cwd = process.cwd(),
	env = process.env,
	config,
	getPortlessUrl = defaultGetPortlessUrl,
	detectWorktreePrefix = defaultDetectWorktreePrefix,
} = {}) {
	const normalized = normalizePackageConfig(config ?? {}, { root: cwd });
	const portlessName = name ?? normalized.portless.name;
	const resolvedTargetPath = targetPath ?? "/";

	if (targetUrl) {
		return targetUrl;
	}

	if (env.PORTLESS_URL) {
		return withTargetPath(env.PORTLESS_URL, resolvedTargetPath);
	}

	const host = resolvePortlessHost({
		name: portlessName,
		cwd,
		env,
		config: normalized,
		getPortlessUrl,
		detectWorktreePrefix,
	});

	const protocol = isHttpsEnabled(normalized, env) ? "https" : "http";
	const port = parsePort(env.PORTLESS_PORT) ?? normalized.portless.port;
	const portSuffix = shouldIncludePort(protocol, port) ? `:${port}` : "";
	return withTargetPath(`${protocol}://${host}${portSuffix}`, resolvedTargetPath);
}

export function resolveRuntimeIdentity({
	name,
	targetUrl,
	appName,
	cwd = process.cwd(),
	env = process.env,
	config,
} = {}) {
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
			worktreePrefix = sanitizeHostnameLabels(prefix);
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
} = {}) {
	const normalized = normalizePackageConfig(config ?? {}, { root: cwd });
	const mfeConfigOptions = normalized.microfrontends;
	const sourcePath = path.resolve(
		normalized.root,
		sourceConfigPath ?? mfeConfigOptions.config,
	);
	const generatedPath = path.join(path.dirname(sourcePath), RUNTIME_CONFIG_FILENAME);
	const sourceConfig = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
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
	const usedPorts = new Set([localProxyPort]);
	const applications = sourceConfig.applications ?? {};
	const resolvedAppDirs = resolveApplicationDirectories({
		root: normalized.root,
		applications,
		overrides: appDirs ?? mfeConfigOptions.apps,
	});
	const appPorts = {};

	for (const appName of Object.keys(applications)) {
		appPorts[appName] = await choosePort(`${host}:${appName}`, {
			min: mfeConfigOptions.appPortRange.min,
			max: mfeConfigOptions.appPortRange.max,
			usedPorts,
			portAvailable,
		});
		usedPorts.add(appPorts[appName]);
	}

	const generatedConfig = {
		...sourceConfig,
		options: {
			...(sourceConfig.options ?? {}),
			localProxyPort,
		},
		applications: Object.fromEntries(
			Object.entries(applications).map(([appName, appConfig]) => [
				appName,
				{
					...appConfig,
					development: {
						...(appConfig.development ?? {}),
						local: appPorts[appName],
					},
				},
			]),
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
		appPorts,
		appDirs: resolvedAppDirs,
		sourceConfig,
		generatedConfig,
		sourceConfigPath: sourcePath,
		generatedConfigPath: generatedPath,
		runtimeConfigFilename: RUNTIME_CONFIG_FILENAME,
		localAppNames: Object.keys(applications),
	};
}

export function normalizePackageConfig(rawConfig, { root = process.cwd(), configPath } = {}) {
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
			appPortRange: {
				min: parsePort(microfrontends.appPortRange?.min) ?? DEFAULT_APP_PORT_RANGE.min,
				max: parsePort(microfrontends.appPortRange?.max) ?? DEFAULT_APP_PORT_RANGE.max,
			},
			proxyPortRange: {
				min: parsePort(microfrontends.proxyPortRange?.min) ?? DEFAULT_PROXY_PORT_RANGE.min,
				max: parsePort(microfrontends.proxyPortRange?.max) ?? DEFAULT_PROXY_PORT_RANGE.max,
			},
		},
	};
}

export function selectLocalAppNames(applications, requestedApps = []) {
	const allAppNames = Object.keys(applications ?? {});
	const requested = requestedApps.filter(Boolean);

	if (!requested.length) {
		return allAppNames;
	}

	const unknownApps = requested.filter((appName) => !allAppNames.includes(appName));
	if (unknownApps.length) {
		throw new Error(
			`Unknown local app(s): ${unknownApps.join(", ")}. Available apps: ${allAppNames.join(", ")}`,
		);
	}

	return Array.from(new Set(requested));
}

export function resolvePortlessHost({
	name,
	cwd = process.cwd(),
	env = process.env,
	config,
	getPortlessUrl = defaultGetPortlessUrl,
	detectWorktreePrefix = defaultDetectWorktreePrefix,
} = {}) {
	const normalized = normalizePackageConfig(config ?? {}, { root: cwd });
	const portlessName = name ?? normalized.portless.name;
	const url = env.PORTLESS_URL || getPortlessUrl(portlessName, { cwd, env });

	if (url) {
		try {
			return new URL(url).hostname;
		} catch {
			// Fall through to git-derived host construction.
		}
	}

	const prefix = detectWorktreePrefix(cwd);
	const effectiveName = prefix ? `${prefix}.${portlessName}` : portlessName;
	return `${effectiveName}.${env.PORTLESS_TLD || normalized.portless.tld}`;
}

export function resolveApplicationDirectories({ root, applications, overrides = {} }) {
	const workspacePackages = discoverWorkspacePackages(root);
	const byName = new Map();
	const byShortName = new Map();

	for (const pkg of workspacePackages) {
		byName.set(pkg.name, pkg.dir);
		byShortName.set(packageShortName(pkg.name), pkg.dir);
	}

	return Object.fromEntries(
		Object.entries(applications).flatMap(([appName, appConfig]) => {
			const override = overrides[appName];
			if (override) {
				return [[appName, path.resolve(root, override)]];
			}

			const packageName = appConfig.packageName ?? appName;
			const dir = byName.get(packageName) ?? byShortName.get(packageName);
			return dir ? [[appName, dir]] : [];
		}),
	);
}

export function discoverWorkspacePackages(root) {
	const patterns = discoverWorkspacePatterns(root);
	const packages = [];

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

export async function resolveLocalProxyPort(host, { env = process.env, range, portAvailable = isPortAvailable } = {}) {
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

export async function choosePort(seed, { min, max, usedPorts = new Set(), portAvailable = isPortAvailable }) {
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

export function defaultDetectWorktreePrefix(cwd = process.cwd()) {
	const cliPrefix = detectWorktreeViaGitCli(cwd);
	if (cliPrefix !== undefined) {
		return cliPrefix;
	}

	return detectWorktreeViaFilesystem(cwd);
}

export function branchToPrefix(branch) {
	if (!branch || branch === "HEAD" || branch === "main" || branch === "master") {
		return undefined;
	}

	const lastSegment = branch.split("/").pop() ?? "";
	const prefix = sanitizeHostnameLabels(lastSegment);
	return prefix || undefined;
}

export function withTargetPath(baseUrl, targetPath = "/") {
	if (targetPath === "" || targetPath === undefined || targetPath === null) {
		return new URL(baseUrl).toString();
	}

	const normalizedPath = String(targetPath).startsWith("/")
		? String(targetPath)
		: `/${targetPath}`;
	return new URL(normalizedPath, baseUrl).toString();
}

export function buildPortlessEnv(config, env = process.env) {
	const normalized = normalizePackageConfig(config ?? {}, { root: process.cwd() });
	return {
		...env,
		PORTLESS_PORT: String(parsePort(env.PORTLESS_PORT) ?? normalized.portless.port),
		PORTLESS_HTTPS: env.PORTLESS_HTTPS ?? (normalized.portless.https ? "1" : "0"),
		...(env.PORTLESS_TLD ? {} : { PORTLESS_TLD: normalized.portless.tld }),
	};
}

export function startPortlessProxy({ config, cwd = process.cwd(), env = process.env, runner = spawnSync } = {}) {
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

export function defaultGetPortlessUrl(name, { cwd = process.cwd(), env = process.env, runner = spawnSync } = {}) {
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

function runWithFallbackCommands({ commands, cwd, env, runner, stdio }) {
	let lastResult = { status: 1, stdout: "", stderr: "" };

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

function discoverWorkspacePatterns(root) {
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

function parsePnpmWorkspacePackages(contents) {
	const patterns = [];
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

function expandWorkspacePattern(root, pattern) {
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

function detectWorktreeViaGitCli(cwd) {
	const list = spawnSync("git", ["worktree", "list", "--porcelain"], {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	});

	if (list.status !== 0) {
		return undefined;
	}

	const worktreeCount = list.stdout
		.split("\n")
		.filter((line) => line.startsWith("worktree ")).length;
	if (worktreeCount <= 1) {
		return undefined;
	}

	const gitDir = spawnSync("git", ["rev-parse", "--git-dir"], {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	});
	const commonDir = spawnSync("git", ["rev-parse", "--git-common-dir"], {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	});
	const branch = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	});

	if (
		gitDir.status !== 0 ||
		commonDir.status !== 0 ||
		branch.status !== 0 ||
		path.resolve(cwd, gitDir.stdout.trim()) === path.resolve(cwd, commonDir.stdout.trim())
	) {
		return undefined;
	}

	return branchToPrefix(branch.stdout.trim());
}

function detectWorktreeViaFilesystem(startDir) {
	let dir = startDir;

	for (;;) {
		const gitPath = path.join(dir, ".git");
		try {
			const stat = fs.statSync(gitPath);
			if (stat.isDirectory()) {
				return undefined;
			}
			if (stat.isFile()) {
				const content = fs.readFileSync(gitPath, "utf8").trim();
				const match = content.match(/^gitdir:\s*(.+)$/);
				if (!match) {
					return undefined;
				}
				const gitDir = path.resolve(dir, match[1]);
				if (!gitDir.match(/[/\\]worktrees[/\\][^/\\]+$/)) {
					return undefined;
				}
				return branchToPrefix(readBranchFromHead(gitDir) ?? "");
			}
		} catch {
			// Keep walking upward.
		}

		const parent = path.dirname(dir);
		if (parent === dir) {
			return undefined;
		}
		dir = parent;
	}
}

function readBranchFromHead(gitDir) {
	try {
		const head = fs.readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
		const match = head.match(/^ref: refs\/heads\/(.+)$/);
		return match?.[1];
	} catch {
		return undefined;
	}
}

function isHttpsEnabled(config, env) {
	if (env.PORTLESS_HTTPS !== undefined) {
		return env.PORTLESS_HTTPS !== "0" && env.PORTLESS_HTTPS !== "false";
	}
	return Boolean(config.portless.https);
}

function shouldIncludePort(protocol, port) {
	return Boolean(port) && !((protocol === "https" && port === 443) || (protocol === "http" && port === 80));
}

function sanitizeHostnameLabels(value) {
	return value
		.split(".")
		.join("-")
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.replace(/--+/g, "-");
}

function packageShortName(name) {
	return name.split("/").pop() ?? name;
}

function positiveHash(value) {
	let hash = 0;
	for (let i = 0; i < value.length; i++) {
		hash = (hash << 5) - hash + value.charCodeAt(i);
		hash |= 0;
	}
	return Math.abs(hash);
}

function parsePort(value) {
	if (value === undefined || value === null || value === "") {
		return undefined;
	}

	const port = Number.parseInt(String(value), 10);
	return Number.isInteger(port) && port > 0 && port < 65536 ? port : undefined;
}

function isPortAvailable(port) {
	return new Promise((resolve) => {
		const server = net.createServer();

		server.once("error", () => resolve(false));
		server.once("listening", () => {
			server.close(() => resolve(true));
		});
		server.listen(port, "127.0.0.1");
	});
}
