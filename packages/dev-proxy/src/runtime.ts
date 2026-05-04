import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type {
	ChildProcess,
	SpawnOptions,
	StdioOptions,
} from "node:child_process";
import {
	addTurboDevEnvMode,
	buildPortlessEnv,
	createVercelMicrofrontendsDevConfig,
	createVercelMicrofrontendsDevEnv,
	inferLocalAppNames,
	loadPortlessMfeConfig,
	resolveApplicationPortlessName,
	startPortlessProxy,
} from "./index.js";
import type {
	Env,
	MicrofrontendsSourceConfig,
	VercelMicrofrontendsDevConfigResult,
} from "./index.js";

export interface ProcessExitResult {
	code: number | null;
	signal: NodeJS.Signals | null;
	exitCode: number;
}

export interface DevProxyProcessRuntime {
	child: ChildProcess;
	proxy?: ChildProcess;
	stop(signal?: NodeJS.Signals): void;
	exit: Promise<ProcessExitResult>;
}

export interface DevProxyCommandOptions {
	cwd?: string;
	env?: Env;
	configPath?: string;
	name?: string;
	localApps?: string[];
	commandArgs: string[];
	stdio?: StdioOptions;
	runtimeCommand?: string[];
}

export interface DevProxyDevCommandOptions extends DevProxyCommandOptions {
	proxyConfigPath?: string;
}

export interface DevProxyDevCommandRuntime extends DevProxyProcessRuntime {
	configRoot: string;
	result: VercelMicrofrontendsDevConfigResult;
	localApps: string[];
}

export interface DevProxyAppCommandRuntime extends DevProxyProcessRuntime {
	configRoot: string;
	result: VercelMicrofrontendsDevConfigResult;
	appName: string;
	appPort: number;
}

export type SpawnFallbackCommand = [string, string[], SpawnOptions?];

export async function startDevProxyTurboCommand({
	cwd = process.cwd(),
	env = process.env,
	configPath,
	name,
	localApps = [],
	commandArgs,
	stdio = "inherit",
	runtimeCommand = ["lightfast-dev", "proxy", "dev"],
}: DevProxyCommandOptions): Promise<DevProxyProcessRuntime> {
	if (!commandArgs.length) {
		throw new Error("Dev proxy turbo command requires command arguments.");
	}

	const config = await loadPortlessMfeConfig({ cwd, configPath });
	const portlessName = name ?? config.portless.name;
	const { env: portlessEnv } = startPortlessProxy({
		config: {
			...config,
			portless: {
				...config.portless,
				name: portlessName,
			},
		},
		cwd: config.root,
		env,
	});
	const child = await spawnWithFallback(
		buildPortlessRunCommands({
			portlessName,
			runtimeCommand,
			configPath,
			localApps,
			commandArgs: normalizeTurboCommandArgs(commandArgs),
		}),
		{
			cwd: config.root,
			env: portlessEnv,
			stdio,
		},
	);

	return createSingleChildRuntime(child);
}

export async function startDevProxyRunCommand({
	cwd = process.cwd(),
	env = process.env,
	configPath,
	name,
	localApps = [],
	commandArgs,
	stdio = "inherit",
	runtimeCommand = ["lightfast-dev", "proxy", "dev"],
}: DevProxyCommandOptions): Promise<DevProxyProcessRuntime> {
	if (!commandArgs.length) {
		throw new Error("Dev proxy run command requires command arguments.");
	}

	const config = await loadPortlessMfeConfig({ cwd, configPath });
	const portlessName = name ?? config.portless.name;
	const { env: portlessEnv } = startPortlessProxy({
		config: {
			...config,
			portless: {
				...config.portless,
				name: portlessName,
			},
		},
		cwd: config.root,
		env,
	});
	const child = await spawnWithFallback(
		buildPortlessRunCommands({
			portlessName,
			runtimeCommand,
			configPath,
			localApps,
			commandArgs,
		}),
		{
			cwd: config.root,
			env: portlessEnv,
			stdio,
		},
	);

	return createSingleChildRuntime(child);
}

export async function startDevProxyDevCommand({
	cwd = process.cwd(),
	env = process.env,
	configPath,
	localApps: requestedLocalApps = [],
	commandArgs,
	proxyConfigPath,
	stdio = "inherit",
}: DevProxyDevCommandOptions): Promise<DevProxyDevCommandRuntime> {
	if (!commandArgs.length) {
		throw new Error("Dev proxy dev command requires command arguments.");
	}

	const config = await loadPortlessMfeConfig({ cwd, configPath });
	let result = await createVercelMicrofrontendsDevConfig({
		cwd: config.root,
		config,
		env,
	});
	if (proxyConfigPath) {
		result = {
			...result,
			generatedConfigPath: path.resolve(cwd, proxyConfigPath),
		};
	}
	const localApps = inferLocalAppNames({
		applications: result.sourceConfig.applications,
		requestedApps: requestedLocalApps,
		commandArgs,
		appDirs: result.appDirs,
		cwd,
		root: config.root,
		env,
	});
	const childEnv = createVercelMicrofrontendsDevEnv({
		result,
		localApps,
		env,
	});
	const proxy = await startMicrofrontendsProxyRuntime({
		config,
		result,
		localApps,
		env: childEnv,
		startProxy: !isTurboRunCommand(commandArgs),
		stdio,
	});
	const devCommandArgs = disableTurboFrameworkInference(addTurboDevEnvMode(commandArgs));
	const devEnv = prepareDevCommandEnv(commandArgs, childEnv);
	const child = spawn(devCommandArgs[0], devCommandArgs.slice(1), {
		cwd: config.root,
		env: devEnv,
		stdio,
	});

	return {
		...createLinkedRuntime(child, proxy),
		configRoot: config.root,
		result,
		localApps,
	};
}

export async function startDevProxyRuntime({
	cwd = process.cwd(),
	env = process.env,
	configPath,
	localApps: requestedLocalApps = [],
	stdio = "inherit",
}: Omit<DevProxyCommandOptions, "commandArgs" | "name" | "runtimeCommand">): Promise<DevProxyDevCommandRuntime> {
	const config = await loadPortlessMfeConfig({ cwd, configPath });
	const result = await createVercelMicrofrontendsDevConfig({
		cwd: config.root,
		config,
		env,
	});
	const localApps = inferLocalAppNames({
		applications: result.sourceConfig.applications,
		requestedApps: requestedLocalApps,
		appDirs: result.appDirs,
		cwd,
		root: config.root,
		env,
	});
	const childEnv = createVercelMicrofrontendsDevEnv({
		result,
		localApps,
		env,
	});
	const child = await startMicrofrontendsProxy({
		config,
		result,
		localApps,
		env: childEnv,
		stdio,
	});

	return {
		...createSingleChildRuntime(child),
		configRoot: config.root,
		result,
		localApps,
	};
}

export async function startDevProxyAppCommand({
	cwd = process.cwd(),
	env = process.env,
	configPath,
	commandArgs,
	stdio = "inherit",
	runtimeCommand = ["lightfast-dev", "proxy", "app-runtime"],
}: Pick<DevProxyCommandOptions, "cwd" | "env" | "configPath" | "commandArgs" | "stdio" | "runtimeCommand">): Promise<DevProxyAppCommandRuntime> {
	if (!commandArgs.length) {
		throw new Error("Dev proxy app command requires command arguments.");
	}

	const config = await loadPortlessMfeConfig({ cwd, configPath });
	const appEnv = withExistingMicrofrontendsProxyPort(env);
	const result = await createVercelMicrofrontendsDevConfig({
		cwd: config.root,
		config,
		env: appEnv,
		write: !appEnv.VC_MICROFRONTENDS_CONFIG,
	});
	const [appName, ...extraApps] = inferLocalAppNames({
		applications: result.sourceConfig.applications,
		appDirs: result.appDirs,
		cwd,
		root: config.root,
		env: {},
	});
	if (!appName || extraApps.length) {
		throw new Error("Dev proxy app command must be run from exactly one configured app directory.");
	}

	const appConfig = result.sourceConfig.applications?.[appName] ?? {};
	const appPort = result.appPorts[appName];
	if (!appPort) {
		throw new Error(`Could not resolve local app port for "${appName}".`);
	}
	const portlessName = resolveApplicationPortlessName(appName, appConfig, config);
	const runtimeEnv = createVercelMicrofrontendsDevEnv({
		result,
		localApps: [appName],
		env: buildPortlessEnv(config, appEnv),
	});
	const child = await spawnWithFallback(
		buildPortlessAppCommands({
			portlessName,
			appPort,
			runtimeCommand,
			commandArgs,
		}),
		{
			cwd,
			env: runtimeEnv,
			stdio,
		},
	);

	return {
		...createSingleChildRuntime(child),
		configRoot: config.root,
		result,
		appName,
		appPort,
	};
}

export function startDevProxyAppRuntimeCommand({
	cwd = process.cwd(),
	env = process.env,
	commandArgs,
	stdio = "inherit",
}: Pick<DevProxyCommandOptions, "cwd" | "env" | "commandArgs" | "stdio">): DevProxyProcessRuntime {
	if (!commandArgs.length) {
		throw new Error("Dev proxy app runtime command requires command arguments.");
	}

	const childEnv = {
		...env,
		HOST: "127.0.0.1",
		MFE_DISABLE_LOCAL_PROXY_REWRITE: "1",
	};
	const child = spawn(commandArgs[0], commandArgs.slice(1), {
		cwd,
		env: childEnv,
		stdio,
	});

	return createSingleChildRuntime(child);
}

export function formatDevProxyRuntimeSummary(
	runtime: Pick<DevProxyDevCommandRuntime, "configRoot" | "result" | "localApps">,
): string {
	const { configRoot, result, localApps } = runtime;
	return [
		`MFE worktree host: ${result.host}`,
		`MFE proxy port: ${result.localProxyPort}`,
		`MFE generated config: ${path.relative(configRoot, result.generatedConfigPath)}`,
		`MFE local apps: ${localApps.join(", ")}`,
		...Object.entries(result.appUrls).map(([appName, url]) => `${appName} url: ${url}`),
	].join("\n");
}

export function normalizeTurboCommandArgs(args: string[]): string[] {
	const commandArgs = path.basename(args[0] ?? "") === "turbo" ? args : ["turbo", ...args];
	return addTurboDevEnvMode(commandArgs);
}

export function isTurboRunCommand(commandArgs: string[]): boolean {
	const command = path.basename(commandArgs[0] ?? "");
	if (command === "turbo" && commandArgs.includes("run")) {
		return true;
	}
	return command === "pnpm" &&
		commandArgs[1] === "exec" &&
		commandArgs[2] === "turbo" &&
		commandArgs.includes("run");
}

export function signalExitCode(signal: NodeJS.Signals): number {
	const codes: Partial<Record<NodeJS.Signals, number>> = {
		SIGHUP: 1,
		SIGINT: 2,
		SIGQUIT: 3,
		SIGTERM: 15,
	};

	return 128 + (codes[signal] ?? 0);
}

function buildPortlessRunCommands({
	portlessName,
	runtimeCommand,
	configPath,
	localApps,
	commandArgs,
}: {
	portlessName: string;
	runtimeCommand: string[];
	configPath?: string;
	localApps: string[];
	commandArgs: string[];
}): SpawnFallbackCommand[] {
	const args = [
		"run",
		"--name",
		portlessName,
		...runtimeCommand,
		...(configPath ? ["--config", configPath] : []),
		...localApps.flatMap((appName) => ["--local-app", appName]),
		"--",
		...commandArgs,
	];
	return [
		["portless", args],
		["pnpm", ["exec", "portless", ...args]],
	];
}

function buildPortlessAppCommands({
	portlessName,
	appPort,
	runtimeCommand,
	commandArgs,
}: {
	portlessName: string;
	appPort: number;
	runtimeCommand: string[];
	commandArgs: string[];
}): SpawnFallbackCommand[] {
	const args = [
		"run",
		"--name",
		portlessName,
		"--app-port",
		String(appPort),
		...runtimeCommand,
		"--",
		...commandArgs,
	];
	return [
		["portless", args],
		["pnpm", ["exec", "portless", ...args]],
	];
}

function buildMicrofrontendsProxyArgs(
	result: VercelMicrofrontendsDevConfigResult,
	localApps: string[],
): string[] {
	return [
		"proxy",
		result.generatedConfigPath,
		"--local-apps",
		...localApps,
		"--port",
		String(result.localProxyPort),
	];
}

function startMicrofrontendsProxy({
	config,
	result,
	localApps,
	env,
	stdio,
}: {
	config: { root: string };
	result: VercelMicrofrontendsDevConfigResult;
	localApps: string[];
	env: Env;
	stdio: StdioOptions;
}): Promise<ChildProcess> {
	return spawnWithFallback(
		buildMicrofrontendsProxyCommands(result, localApps),
		{
			cwd: config.root,
			env,
			stdio,
		},
	);
}

async function startMicrofrontendsProxyRuntime({
	config,
	result,
	localApps,
	env,
	startProxy = true,
	stdio,
}: {
	config: { root: string };
	result: VercelMicrofrontendsDevConfigResult;
	localApps: string[];
	env: Env;
	startProxy?: boolean;
	stdio: StdioOptions;
}): Promise<ChildProcess | undefined> {
	if (!startProxy) {
		return undefined;
	}

	return startMicrofrontendsProxy({ config, result, localApps, env, stdio });
}

function buildMicrofrontendsProxyCommands(
	result: VercelMicrofrontendsDevConfigResult,
	localApps: string[],
): SpawnFallbackCommand[] {
	const args = buildMicrofrontendsProxyArgs(result, localApps);
	const appDirs = unique([
		...localApps.map((appName) => result.appDirs[appName]),
		...Object.values(result.appDirs),
	].filter(Boolean));
	const commands: SpawnFallbackCommand[] = [];

	for (const appDir of appDirs) {
		commands.push([
			path.join(appDir, "node_modules", ".bin", "microfrontends"),
			args,
			{ cwd: appDir },
		]);
		commands.push([
			"pnpm",
			["exec", "microfrontends", ...args],
			{ cwd: appDir },
		]);
	}

	commands.push(["microfrontends", args]);
	commands.push(["pnpm", ["exec", "microfrontends", ...args]]);
	return commands;
}

function disableTurboFrameworkInference(commandArgs: string[]): string[] {
	if (!commandArgs.length || !isTurboRunCommand(commandArgs)) {
		return commandArgs;
	}

	if (commandArgs.some((arg) => arg === "--framework-inference" || arg.startsWith("--framework-inference="))) {
		return commandArgs;
	}

	const runIndex = commandArgs.indexOf("run");
	return [
		...commandArgs.slice(0, runIndex + 1),
		"--framework-inference=false",
		...commandArgs.slice(runIndex + 1),
	];
}

function prepareDevCommandEnv(commandArgs: string[], env: Env): Env {
	if (!isTurboRunCommand(commandArgs)) {
		return env;
	}

	const nextEnv = { ...env };
	delete nextEnv.PORT;
	delete nextEnv.HOST;
	delete nextEnv.PORTLESS_URL;
	delete nextEnv.MFE_LOCAL_PROXY_PORT;
	return nextEnv;
}

function withExistingMicrofrontendsProxyPort(env: Env): Env {
	if (env.MFE_LOCAL_PROXY_PORT || !env.VC_MICROFRONTENDS_CONFIG) {
		return env;
	}

	try {
		const config = JSON.parse(
			fs.readFileSync(env.VC_MICROFRONTENDS_CONFIG, "utf8"),
		) as MicrofrontendsSourceConfig;
		const localProxyPort = config.options?.localProxyPort;
		if (
			typeof localProxyPort === "number" &&
			Number.isInteger(localProxyPort) &&
			localProxyPort > 0 &&
			localProxyPort <= 65535
		) {
			return { ...env, MFE_LOCAL_PROXY_PORT: String(localProxyPort) };
		}
	} catch {
		// Standalone app runs may not have a parent-generated config yet.
	}

	return env;
}

function spawnWithFallback(
	commands: SpawnFallbackCommand[],
	options: SpawnOptions,
): Promise<ChildProcess> {
	return new Promise((resolve, reject) => {
		const tryCommand = (index: number) => {
			const [command, args, commandOptions = {}] = commands[index];
			const child = spawn(command, args, { ...options, ...commandOptions });
			let spawned = false;

			child.once("spawn", () => {
				spawned = true;
				resolve(child);
			});

			child.once("error", (error: NodeJS.ErrnoException) => {
				if (!spawned && error.code === "ENOENT" && index + 1 < commands.length) {
					tryCommand(index + 1);
					return;
				}
				reject(error);
			});
		};

		tryCommand(0);
	});
}

function createSingleChildRuntime(child: ChildProcess): DevProxyProcessRuntime {
	let settled = false;
	let resolveExit!: (result: ProcessExitResult) => void;
	const exit = new Promise<ProcessExitResult>((resolve) => {
		resolveExit = resolve;
	});

	child.on("exit", (code, signal) => {
		if (settled) {
			return;
		}
		settled = true;
		resolveExit(toExitResult(code, signal));
	});

	return {
		child,
		stop(signal = "SIGTERM") {
			if (!child.killed) {
				child.kill(signal);
			}
		},
		exit,
	};
}

function createLinkedRuntime(
	child: ChildProcess,
	proxy: ChildProcess | undefined,
): DevProxyProcessRuntime {
	let settled = false;
	let shuttingDown = false;
	let resolveExit!: (result: ProcessExitResult) => void;
	const exit = new Promise<ProcessExitResult>((resolve) => {
		resolveExit = resolve;
	});
	const finish = (code: number | null, signal: NodeJS.Signals | null) => {
		if (settled) {
			return;
		}
		settled = true;
		resolveExit(toExitResult(code, signal));
	};
	const stopProxy = (signal: NodeJS.Signals) => {
		if (proxy && !proxy.killed) {
			proxy.kill(signal);
		}
	};

	if (proxy) {
		proxy.on("exit", (code, signal) => {
			if (shuttingDown) {
				return;
			}

			shuttingDown = true;
			if (!child.killed) {
				child.kill("SIGTERM");
			}
			finish(code ?? 1, signal);
		});
	}

	child.on("exit", (code, signal) => {
		shuttingDown = true;
		stopProxy("SIGTERM");
		finish(code, signal);
	});

	return {
		child,
		proxy,
		stop(signal = "SIGTERM") {
			shuttingDown = true;
			if (!child.killed) {
				child.kill(signal);
			}
			stopProxy(signal);
		},
		exit,
	};
}

function toExitResult(
	code: number | null,
	signal: NodeJS.Signals | null,
): ProcessExitResult {
	return {
		code,
		signal,
		exitCode: signal ? signalExitCode(signal) : code ?? 0,
	};
}

function unique<T>(values: T[]): T[] {
	return Array.from(new Set(values));
}
