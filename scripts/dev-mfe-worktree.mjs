#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SOURCE_CONFIG = path.join(ROOT, "apps/app/microfrontends.json");
const GENERATED_CONFIG = path.join(ROOT, ".turbo/microfrontends.local.json");
const CUSTOM_CONFIG_FILENAME = "microfrontends.local.json";
const PORTLESS_NAME = process.env.PORTLESS_NAME || "mfe";
const APP_PORT_MIN = 5100;
const APP_PORT_MAX = 8999;
const PROXY_PORT_MIN = 9000;
const PROXY_PORT_MAX = 9999;

const RESERVED_PORTS = new Set([
	80,
	443,
	1355,
	3000,
	3001,
	3002,
	3003,
	3024,
	5000,
	5001,
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

const commandArgs = process.argv.slice(2);
if (commandArgs.length === 0) {
	console.error("Usage: node scripts/dev-mfe-worktree.mjs <command> [...args]");
	process.exit(1);
}

const config = JSON.parse(fs.readFileSync(SOURCE_CONFIG, "utf8"));
const host = resolvePortlessHost();
const localProxyPort = await resolveLocalProxyPort(host);
const usedPorts = new Set([localProxyPort]);
const appPorts = {};

for (const appName of Object.keys(config.applications ?? {})) {
	appPorts[appName] = await choosePort(`${host}:${appName}`, {
		min: APP_PORT_MIN,
		max: APP_PORT_MAX,
		usedPorts,
	});
	usedPorts.add(appPorts[appName]);
}

const generatedConfig = {
	...config,
	options: {
		...(config.options ?? {}),
		localProxyPort,
	},
	applications: Object.fromEntries(
		Object.entries(config.applications ?? {}).map(([appName, appConfig]) => [
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

fs.mkdirSync(path.dirname(GENERATED_CONFIG), { recursive: true });
fs.writeFileSync(`${GENERATED_CONFIG}.tmp`, `${JSON.stringify(generatedConfig, null, 2)}\n`);
fs.renameSync(`${GENERATED_CONFIG}.tmp`, GENERATED_CONFIG);
linkPackageConfigs(Object.keys(config.applications ?? {}));

console.log(
	[
		`MFE worktree host: ${host}`,
		`MFE proxy port: ${localProxyPort}`,
		`MFE generated config: ${path.relative(ROOT, GENERATED_CONFIG)}`,
		...Object.entries(appPorts).map(([appName, port]) => `${appName} port: ${port}`),
	].join("\n"),
);

const child = spawn(commandArgs[0], commandArgs.slice(1), {
	cwd: ROOT,
	env: {
		...process.env,
		MFE_LOCAL_PROXY_PORT: String(localProxyPort),
		VC_MICROFRONTENDS_CONFIG_FILE_NAME: CUSTOM_CONFIG_FILENAME,
	},
	stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
	process.on(signal, () => {
		if (!child.killed) {
			child.kill(signal);
		}
	});
}

child.on("exit", (code, signal) => {
	if (signal) {
		process.exit(signalExitCode(signal));
		return;
	}

	process.exit(code ?? 0);
});

function signalExitCode(signal) {
	const codes = {
		SIGHUP: 1,
		SIGINT: 2,
		SIGQUIT: 3,
		SIGTERM: 15,
	};

	return 128 + (codes[signal] ?? 0);
}

function linkPackageConfigs(appNames) {
	for (const appName of appNames) {
		const packageDir = path.join(ROOT, "apps", appName);
		if (!fs.existsSync(packageDir)) {
			continue;
		}

		const linkPath = path.join(packageDir, CUSTOM_CONFIG_FILENAME);
		const relativeTarget = path.relative(packageDir, GENERATED_CONFIG);

		try {
			fs.rmSync(linkPath, { force: true });
			fs.symlinkSync(relativeTarget, linkPath);
		} catch {
			fs.copyFileSync(GENERATED_CONFIG, linkPath);
		}
	}
}

function resolvePortlessHost() {
	const url = process.env.PORTLESS_URL || getPortlessUrl(PORTLESS_NAME);
	if (url) {
		try {
			return new URL(url).hostname;
		} catch {
			// Fall through to a git-derived identity.
		}
	}

	const prefix = detectWorktreeHostPrefix();
	return prefix ? `${prefix}.${PORTLESS_NAME}.localhost` : `${PORTLESS_NAME}.localhost`;
}

function getPortlessUrl(name) {
	const commands = [
		["portless", ["get", name]],
		["pnpm", ["exec", "portless", "get", name]],
	];

	for (const [command, args] of commands) {
		const result = spawnSync(command, args, {
			cwd: ROOT,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		});

		if (result.status === 0 && result.stdout.trim()) {
			return result.stdout.trim();
		}
	}

	return undefined;
}

function detectWorktreeHostPrefix() {
	const list = spawnSync("git", ["worktree", "list", "--porcelain"], {
		cwd: ROOT,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	});

	if (list.status !== 0 || list.stdout.split("\n").filter((line) => line.startsWith("worktree ")).length <= 1) {
		return undefined;
	}

	const gitDir = spawnSync("git", ["rev-parse", "--git-dir"], {
		cwd: ROOT,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	});
	const commonDir = spawnSync("git", ["rev-parse", "--git-common-dir"], {
		cwd: ROOT,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	});
	const branch = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
		cwd: ROOT,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	});

	if (
		gitDir.status !== 0 ||
		commonDir.status !== 0 ||
		branch.status !== 0 ||
		path.resolve(ROOT, gitDir.stdout.trim()) === path.resolve(ROOT, commonDir.stdout.trim())
	) {
		return undefined;
	}

	return branchToPrefix(branch.stdout.trim());
}

function branchToPrefix(branch) {
	if (!branch || branch === "HEAD" || branch === "main" || branch === "master") {
		return undefined;
	}

	const lastSegment = branch.split("/").pop() ?? "";
	const prefix = lastSegment
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.replace(/--+/g, "-");

	return prefix || undefined;
}

async function resolveLocalProxyPort(host) {
	const explicitPort = parsePort(process.env.PORT) ?? parsePort(process.env.MFE_LOCAL_PROXY_PORT);
	if (explicitPort) {
		return explicitPort;
	}

	return choosePort(`${host}:proxy`, {
		min: PROXY_PORT_MIN,
		max: PROXY_PORT_MAX,
		usedPorts: new Set(),
	});
}

async function choosePort(seed, { min, max, usedPorts }) {
	const size = max - min + 1;
	const offset = positiveHash(seed) % size;

	for (let i = 0; i < size; i++) {
		const port = min + ((offset + i) % size);
		if (RESERVED_PORTS.has(port) || usedPorts.has(port)) {
			continue;
		}

		if (await isPortAvailable(port)) {
			return port;
		}
	}

	throw new Error(`No available port found in range ${min}-${max} for ${seed}`);
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
	if (!value) {
		return undefined;
	}

	const port = Number.parseInt(value, 10);
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
