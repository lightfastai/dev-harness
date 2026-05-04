#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import {
	addTurboDevEnvMode,
	buildPortlessEnv,
	createVercelMicrofrontendsDevEnv,
	createVercelMicrofrontendsDevConfig,
	inferLocalAppNames,
	loadPortlessMfeConfig,
	resolveApplicationPortlessName,
	resolvePortlessApplicationUrl,
	resolvePortlessMfeRuntime,
	resolvePortlessMfeUrl,
	startPortlessProxy,
} from "./index.js";
import type {
	Env,
	MicrofrontendsSourceConfig,
	VercelMicrofrontendsDevConfigResult,
} from "./index.js";

const SIGNALS: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];

interface CliOptions {
	config?: string;
	name?: string;
	path?: string;
	targetUrl?: string;
	appName?: string;
	app?: string;
	json?: boolean;
	proxyConfigPath?: string;
	localApps: string[];
}

interface ParsedCommandArgs {
	options: CliOptions;
	commandArgs: string[];
}

interface ParsedTurboArgs {
	options: CliOptions;
	turboArgs: string[];
}

interface ParsedOptions {
	options: CliOptions;
}

type SpawnFallbackCommand = [string, string[], SpawnOptions?];

const args = process.argv.slice(2);
const command = args.shift();

try {
	switch (command) {
		case "turbo":
			await handleTurbo(args);
			break;
		case "dev":
			await handleDev(args);
			break;
		case "run":
			await handleRun(args);
			break;
		case "app":
			await handleApp(args);
			break;
		case "app-runtime":
			await handleAppRuntime(args);
			break;
		case "url":
			await handleUrl(args);
			break;
		case "identity":
			await handleIdentity(args);
			break;
		case "proxy":
			await handleProxy(args);
			break;
		case "-h":
		case "--help":
		case undefined:
			printHelp();
			process.exit(command ? 0 : 1);
			break;
		default:
			throw new Error(`Unknown command "${command}".`);
	}
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
}

async function handleTurbo(args: string[]): Promise<void> {
	const { options, turboArgs } = parseTurboArgs(args);
	if (!turboArgs.length) {
		throw new Error("Usage: portless-mfe turbo [options] run dev [...turbo args]");
	}

	const config = await loadPortlessMfeConfig({
		cwd: process.cwd(),
		configPath: options.config,
	});
	const portlessName = options.name ?? config.portless.name;
	const { env } = startPortlessProxy({
		config: {
			...config,
			portless: {
				...config.portless,
				name: portlessName,
			},
		},
		cwd: config.root,
		env: process.env,
	});
	const turboCommandArgs = normalizeTurboCommandArgs(turboArgs);
	const child = spawn(
		"portless",
		[
			"run",
			"--name",
			portlessName,
			"portless-mfe",
			"dev",
			...(options.config ? ["--config", options.config] : []),
			...options.localApps.flatMap((appName) => ["--local-app", appName]),
			"--",
			...turboCommandArgs,
		],
		{
			cwd: config.root,
			env,
			stdio: "inherit",
		},
	);

	for (const signal of SIGNALS) {
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
}

async function handleDev(args: string[]): Promise<void> {
	const { options, commandArgs } = parseCommandArgs(args);
	if (!commandArgs.length) {
		throw new Error("Usage: portless-mfe dev -- <command> [...args]");
	}

	const config = await loadPortlessMfeConfig({
		cwd: process.cwd(),
		configPath: options.config,
	});
	let result = await createVercelMicrofrontendsDevConfig({
		cwd: config.root,
		config,
		env: process.env,
	});
	if (options.proxyConfigPath) {
		result = {
			...result,
			generatedConfigPath: path.resolve(process.cwd(), options.proxyConfigPath),
		};
	}
	const localApps = inferLocalAppNames({
		applications: result.sourceConfig.applications,
		requestedApps: options.localApps,
		commandArgs,
		appDirs: result.appDirs,
		cwd: process.cwd(),
		root: config.root,
		env: process.env,
	});

	console.log(
		[
			`MFE worktree host: ${result.host}`,
			`MFE proxy port: ${result.localProxyPort}`,
			`MFE generated config: ${path.relative(config.root, result.generatedConfigPath)}`,
			`MFE local apps: ${localApps.join(", ")}`,
			...Object.entries(result.appUrls).map(([appName, url]) => `${appName} url: ${url}`),
		].join("\n"),
	);

	const childEnv = createVercelMicrofrontendsDevEnv({
		result,
		localApps,
		env: process.env,
	});
	const proxyRuntime = await startMicrofrontendsProxyRuntime({
		config,
		result,
		localApps,
		env: childEnv,
		startProxy: !isTurboRunCommand(commandArgs),
	});
	const devCommandArgs = disableTurboFrameworkInference(addTurboDevEnvMode(commandArgs));
	const devEnv = prepareDevCommandEnv(commandArgs, childEnv);
	const child = spawn(devCommandArgs[0], devCommandArgs.slice(1), {
		cwd: config.root,
		env: devEnv,
		stdio: "inherit",
	});
	let shuttingDown = false;

	const shutdown = (signal: NodeJS.Signals) => {
		shuttingDown = true;
		if (!child.killed) {
			child.kill(signal);
		}
		stopMicrofrontendsProxyRuntime(proxyRuntime, signal);
	};

	for (const signal of SIGNALS) {
		process.on(signal, () => shutdown(signal));
	}

	if (proxyRuntime) {
		proxyRuntime.on("exit", (code, signal) => {
			if (shuttingDown) {
				return;
			}

			shuttingDown = true;
			if (!child.killed) {
				child.kill("SIGTERM");
			}
			if (signal) {
				process.exit(signalExitCode(signal));
			}
			process.exit(code ?? 1);
		});
	}

	child.on("exit", (code, signal) => {
		shuttingDown = true;
		stopMicrofrontendsProxyRuntime(proxyRuntime, "SIGTERM");
		if (signal) {
			process.exit(signalExitCode(signal));
			return;
		}

		process.exit(code ?? 0);
	});
}

async function handleProxy(args: string[]): Promise<void> {
	const { options } = parseProxyOptions(args);
	const config = await loadPortlessMfeConfig({
		cwd: process.cwd(),
		configPath: options.config,
	});
	const result = await createVercelMicrofrontendsDevConfig({
		cwd: config.root,
		config,
		env: process.env,
	});
	const localApps = inferLocalAppNames({
		applications: result.sourceConfig.applications,
		requestedApps: options.localApps,
		appDirs: result.appDirs,
		cwd: process.cwd(),
		root: config.root,
		env: process.env,
	});
	const proxyEnv = createVercelMicrofrontendsDevEnv({
		result,
		localApps,
		env: process.env,
	});
	const proxyRuntime = await startMicrofrontendsProxyRuntime({
		config,
		result,
		localApps,
		env: proxyEnv,
	});

	for (const signal of SIGNALS) {
		process.on(signal, () => {
			stopMicrofrontendsProxyRuntime(proxyRuntime, signal);
		});
	}

	proxyRuntime?.on("exit", (code, signal) => {
		if (signal) {
			process.exit(signalExitCode(signal));
			return;
		}
		process.exit(code ?? 0);
	});
}

async function handleApp(args: string[]): Promise<void> {
	const { options, commandArgs } = parseCommandArgs(args);
	if (!commandArgs.length) {
		throw new Error("Usage: portless-mfe app -- <command> [...args]");
	}

	const config = await loadPortlessMfeConfig({
		cwd: process.cwd(),
		configPath: options.config,
	});
	const appEnv = withExistingMicrofrontendsProxyPort(process.env);
	const result = await createVercelMicrofrontendsDevConfig({
		cwd: config.root,
		config,
		env: appEnv,
		write: !appEnv.VC_MICROFRONTENDS_CONFIG,
	});
	const [appName, ...extraApps] = inferLocalAppNames({
		applications: result.sourceConfig.applications,
		appDirs: result.appDirs,
		cwd: process.cwd(),
		root: config.root,
		env: {},
	});
	if (!appName || extraApps.length) {
		throw new Error("portless-mfe app must be run from exactly one configured app directory.");
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
	const child = spawn("portless", [
		"run",
		"--name",
		portlessName,
		"--app-port",
		String(appPort),
		"portless-mfe",
		"app-runtime",
		"--",
		...commandArgs,
	], {
		cwd: process.cwd(),
		env: runtimeEnv,
		stdio: "inherit",
	});

	for (const signal of SIGNALS) {
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
}

async function handleAppRuntime(args: string[]): Promise<void> {
	const { commandArgs } = parseCommandArgs(args);
	if (!commandArgs.length) {
		throw new Error("Usage: portless-mfe app-runtime -- <command> [...args]");
	}

	const childEnv = {
		...process.env,
		HOST: "127.0.0.1",
		MFE_DISABLE_LOCAL_PROXY_REWRITE: "1",
	};
	const child = spawn(commandArgs[0], commandArgs.slice(1), {
		cwd: process.cwd(),
		env: childEnv,
		stdio: "inherit",
	});

	const shutdown = (signal: NodeJS.Signals) => {
		if (!child.killed) {
			child.kill(signal);
		}
	};

	for (const signal of SIGNALS) {
		process.on(signal, () => shutdown(signal));
	}

	child.on("exit", (code, signal) => {
		if (signal) {
			process.exit(signalExitCode(signal));
			return;
		}

		process.exit(code ?? 0);
	});
}

function parseProxyOptions(args: string[]): ParsedOptions {
	const options: CliOptions = { localApps: [] };

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];

		switch (arg) {
			case "--config":
				options.config = readOptionValue(args, ++i, arg);
				break;
			case "--local-app":
				options.localApps.push(readOptionValue(args, ++i, arg));
				break;
			case "--local-apps":
			case "--names":
				for (i++; i < args.length && !args[i].startsWith("--"); i++) {
					options.localApps.push(args[i]);
				}
				i--;
				break;
			case "-h":
			case "--help":
				printHelp();
				process.exit(0);
				break;
			default:
				if (!arg.startsWith("--") && !options.proxyConfigPath) {
					options.proxyConfigPath = arg;
					break;
				}
				throw new Error(`Unknown option "${arg}".`);
		}
	}

	return { options };
}

function parseTurboArgs(args: string[]): ParsedTurboArgs {
	const options: CliOptions = { localApps: [] };
	let index = 0;

	for (; index < args.length; index++) {
		const arg = args[index];

		if (arg === "--") {
			index++;
			break;
		}

		if (arg === "--config") {
			options.config = readOptionValue(args, ++index, arg);
			continue;
		}
		if (arg.startsWith("--config=")) {
			options.config = arg.slice("--config=".length);
			continue;
		}
		if (arg === "--name") {
			options.name = readOptionValue(args, ++index, arg);
			continue;
		}
		if (arg.startsWith("--name=")) {
			options.name = arg.slice("--name=".length);
			continue;
		}
		if (arg === "--local-app") {
			options.localApps.push(readOptionValue(args, ++index, arg));
			continue;
		}
		if (arg.startsWith("--local-app=")) {
			options.localApps.push(arg.slice("--local-app=".length));
			continue;
		}
		if (arg === "-h" || arg === "--help") {
			printHelp();
			process.exit(0);
		}

		break;
	}

	return { options, turboArgs: args.slice(index) };
}

function normalizeTurboCommandArgs(args: string[]): string[] {
	const commandArgs = path.basename(args[0] ?? "") === "turbo" ? args : ["turbo", ...args];
	return addTurboDevEnvMode(commandArgs);
}

async function handleRun(args: string[]): Promise<void> {
	const { options, commandArgs } = parseCommandArgs(args);
	if (!commandArgs.length) {
		throw new Error("Usage: portless-mfe run -- <command> [...args]");
	}

	const config = await loadPortlessMfeConfig({
		cwd: process.cwd(),
		configPath: options.config,
	});
	const portlessName = options.name ?? config.portless.name;
	const { env } = startPortlessProxy({
		config: {
			...config,
			portless: {
				...config.portless,
				name: portlessName,
			},
		},
		cwd: config.root,
		env: process.env,
	});
	const child = spawn(
		"portless",
		[
			"run",
			"--name",
			portlessName,
			"portless-mfe",
			"dev",
			...(options.config ? ["--config", options.config] : []),
			...options.localApps.flatMap((appName) => ["--local-app", appName]),
			"--",
			...commandArgs,
		],
		{
			cwd: config.root,
			env,
			stdio: "inherit",
		},
	);

	for (const signal of SIGNALS) {
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
}

async function handleUrl(args: string[]): Promise<void> {
	const { options } = parseOptions(args);
	const targetUrl = options.app
		? resolvePortlessApplicationUrl({
			app: options.app,
			path: options.path,
			targetUrl: options.targetUrl,
			cwd: process.cwd(),
			env: process.env,
			configPath: options.config,
		})
		: resolvePortlessMfeUrl({
			name: options.name,
			path: options.path,
			targetUrl: options.targetUrl,
			cwd: process.cwd(),
			env: process.env,
			configPath: options.config,
		});

	if (options.json) {
		console.log(JSON.stringify({ targetUrl }));
		return;
	}

	console.log(targetUrl);
}

async function handleIdentity(args: string[]): Promise<void> {
	const { options } = parseOptions(args);
	const identity = resolvePortlessMfeRuntime({
		name: options.name,
		path: options.path,
		targetUrl: options.targetUrl,
		appName: options.appName,
		env: process.env,
		cwd: process.cwd(),
		configPath: options.config,
	});

	if (options.json) {
		console.log(JSON.stringify(identity));
		return;
	}

	console.log(identity.name);
}

function parseCommandArgs(args: string[]): ParsedCommandArgs {
	const separatorIndex = args.indexOf("--");
	const optionArgs = separatorIndex === -1 ? [] : args.slice(0, separatorIndex);
	const commandArgs = separatorIndex === -1 ? args : args.slice(separatorIndex + 1);
	const { options } = parseOptions(optionArgs);
	return { options, commandArgs };
}

function parseOptions(args: string[]): ParsedOptions {
	const options: CliOptions = { localApps: [] };

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];

		switch (arg) {
			case "--config":
				options.config = readOptionValue(args, ++i, arg);
				break;
			case "--name":
				options.name = readOptionValue(args, ++i, arg);
				break;
			case "--path":
				options.path = readOptionValue(args, ++i, arg);
				break;
			case "--target-url":
				options.targetUrl = readOptionValue(args, ++i, arg);
				break;
			case "--app-name":
				options.appName = readOptionValue(args, ++i, arg);
				break;
			case "--app":
				options.app = readOptionValue(args, ++i, arg);
				break;
			case "--local-app":
				options.localApps.push(readOptionValue(args, ++i, arg));
				break;
			case "--json":
				options.json = true;
				break;
			case "-h":
			case "--help":
				printHelp();
				process.exit(0);
				break;
			default:
				throw new Error(`Unknown option "${arg}".`);
		}
	}

	return { options };
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
}: {
	config: { root: string };
	result: VercelMicrofrontendsDevConfigResult;
	localApps: string[];
	env: Env;
}): Promise<ChildProcess> {
	return spawnWithFallback(
		buildMicrofrontendsProxyCommands(result, localApps),
		{
			cwd: config.root,
			env,
			stdio: "inherit",
		},
	);
}

async function startMicrofrontendsProxyRuntime({
	config,
	result,
	localApps,
	env,
	startProxy = true,
}: {
	config: { root: string };
	result: VercelMicrofrontendsDevConfigResult;
	localApps: string[];
	env: Env;
	startProxy?: boolean;
}): Promise<ChildProcess | undefined> {
	if (!startProxy) {
		return undefined;
	}

	return startMicrofrontendsProxy({ config, result, localApps, env });
}

function stopMicrofrontendsProxyRuntime(
	runtime: ChildProcess | undefined,
	signal: NodeJS.Signals,
): void {
	if (!runtime) {
		return;
	}
	if (!runtime.killed) {
		runtime.kill(signal);
	}
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

function isTurboRunCommand(commandArgs: string[]): boolean {
	const command = path.basename(commandArgs[0]);
	if (command === "turbo" && commandArgs.includes("run")) {
		return true;
	}
	return command === "pnpm" &&
		commandArgs[1] === "exec" &&
		commandArgs[2] === "turbo" &&
		commandArgs.includes("run");
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

function unique<T>(values: T[]): T[] {
	return Array.from(new Set(values));
}

function readOptionValue(args: string[], index: number, flag: string): string {
	const value = args[index];
	if (!value) {
		throw new Error(`${flag} requires a value.`);
	}
	return value;
}

function signalExitCode(signal: NodeJS.Signals): number {
	const codes: Partial<Record<NodeJS.Signals, number>> = {
		SIGHUP: 1,
		SIGINT: 2,
		SIGQUIT: 3,
		SIGTERM: 15,
	};

	return 128 + (codes[signal] ?? 0);
}

function printHelp() {
	console.log(`Usage:
  portless-mfe turbo [--name <name>] [--local-app <name>] run dev [...turbo args]
  portless-mfe dev [--local-app <name>] -- <command> [...args]
  portless-mfe run [--name <name>] [--local-app <name>] -- <command> [...args]
  portless-mfe app -- <command> [...args]
  portless-mfe proxy [--local-app <name>]
  portless-mfe url [--app <name>] [--path <path>] [--json]
  portless-mfe identity [--path <path>] [--app-name <name>] [--json]

Options:
  --config <path>       Path to related-projects.json
  --name <name>         Portless base route name
  --local-app <name>    Locally running Vercel Microfrontends application
  --path <path>         Target path to append to the Portless URL
  --target-url <url>    Explicit target URL override
  --app-name <name>     Runtime base app name for identity
  --json                Print JSON output
`);
}
