#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import {
	addTurboDevEnvMode,
	createVercelMicrofrontendsDevEnv,
	createVercelMicrofrontendsDevConfig,
	inferLocalAppNames,
	loadPortlessMfeConfig,
	resolvePortlessMfeRuntime,
	resolvePortlessMfeUrl,
	startPortlessProxy,
} from "../src/index.js";

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

async function handleTurbo(args) {
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
}

async function handleDev(args) {
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
			...Object.entries(result.appPorts).map(([appName, port]) => `${appName} port: ${port}`),
		].join("\n"),
	);

	const childEnv = createVercelMicrofrontendsDevEnv({
		result,
		localApps,
		env: process.env,
	});
	const shouldStartProxy = !isTurboRunCommand(commandArgs);
	const proxy = shouldStartProxy
		? await startMicrofrontendsProxy({ config, result, localApps, env: childEnv })
		: undefined;
	const devCommandArgs = disableTurboFrameworkInference(addTurboDevEnvMode(commandArgs));
	const child = spawn(devCommandArgs[0], devCommandArgs.slice(1), {
		cwd: config.root,
		env: childEnv,
		stdio: "inherit",
	});
	let shuttingDown = false;

	const shutdown = (signal) => {
		shuttingDown = true;
		if (!child.killed) {
			child.kill(signal);
		}
		if (proxy && !proxy.killed) {
			proxy.kill(signal);
		}
	};

	for (const signal of ["SIGINT", "SIGTERM"]) {
		process.on(signal, () => shutdown(signal));
	}

	if (proxy) {
		proxy.on("exit", (code, signal) => {
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
		if (proxy && !proxy.killed) {
			proxy.kill("SIGTERM");
		}
		if (signal) {
			process.exit(signalExitCode(signal));
			return;
		}

		process.exit(code ?? 0);
	});
}

async function handleProxy(args) {
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
	const proxy = await startMicrofrontendsProxy({
		config,
		result,
		localApps,
		env: proxyEnv,
	});

	for (const signal of ["SIGINT", "SIGTERM"]) {
		process.on(signal, () => {
			if (!proxy.killed) {
				proxy.kill(signal);
			}
		});
	}

	proxy.on("exit", (code, signal) => {
		if (signal) {
			process.exit(signalExitCode(signal));
			return;
		}
		process.exit(code ?? 0);
	});
}

function parseProxyOptions(args) {
	const options = { localApps: [] };

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

function parseTurboArgs(args) {
	const options = { localApps: [] };
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

function normalizeTurboCommandArgs(args) {
	const commandArgs = path.basename(args[0] ?? "") === "turbo" ? args : ["turbo", ...args];
	return addTurboDevEnvMode(commandArgs);
}

async function handleRun(args) {
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
}

async function handleUrl(args) {
	const { options } = parseOptions(args);
	const targetUrl = resolvePortlessMfeUrl({
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

async function handleIdentity(args) {
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

function parseCommandArgs(args) {
	const separatorIndex = args.indexOf("--");
	const optionArgs = separatorIndex === -1 ? [] : args.slice(0, separatorIndex);
	const commandArgs = separatorIndex === -1 ? args : args.slice(separatorIndex + 1);
	const { options } = parseOptions(optionArgs);
	return { options, commandArgs };
}

function parseOptions(args) {
	const options = { localApps: [] };

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

function buildMicrofrontendsProxyArgs(result, localApps) {
	return [
		"proxy",
		result.generatedConfigPath,
		"--local-apps",
		...localApps,
		"--port",
		String(result.localProxyPort),
	];
}

function startMicrofrontendsProxy({ config, result, localApps, env }) {
	return spawnWithFallback(
		buildMicrofrontendsProxyCommands(result, localApps),
		{
			cwd: config.root,
			env,
			stdio: "inherit",
		},
	);
}

function buildMicrofrontendsProxyCommands(result, localApps) {
	const args = buildMicrofrontendsProxyArgs(result, localApps);
	const appDirs = unique([
		...localApps.map((appName) => result.appDirs[appName]),
		...Object.values(result.appDirs),
	].filter(Boolean));
	const commands = [];

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

function disableTurboFrameworkInference(commandArgs) {
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

function isTurboRunCommand(commandArgs) {
	const command = path.basename(commandArgs[0]);
	if (command === "turbo" && commandArgs.includes("run")) {
		return true;
	}
	return command === "pnpm" &&
		commandArgs[1] === "exec" &&
		commandArgs[2] === "turbo" &&
		commandArgs.includes("run");
}

function spawnWithFallback(commands, options) {
	return new Promise((resolve, reject) => {
		const tryCommand = (index) => {
			const [command, args, commandOptions = {}] = commands[index];
			const child = spawn(command, args, { ...options, ...commandOptions });
			let spawned = false;

			child.once("spawn", () => {
				spawned = true;
				resolve(child);
			});

			child.once("error", (error) => {
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

function unique(values) {
	return Array.from(new Set(values));
}

function readOptionValue(args, index, flag) {
	const value = args[index];
	if (!value) {
		throw new Error(`${flag} requires a value.`);
	}
	return value;
}

function signalExitCode(signal) {
	const codes = {
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
  portless-mfe proxy [--local-app <name>]
  portless-mfe url [--path <path>] [--json]
  portless-mfe identity [--path <path>] [--app-name <name>] [--json]

Options:
  --config <path>       Path to portless-mfe.config.json
  --name <name>         Portless base route name
  --local-app <name>    Locally running Vercel Microfrontends application
  --path <path>         Target path to append to the Portless URL
  --target-url <url>    Explicit target URL override
  --app-name <name>     Runtime base app name for identity
  --json                Print JSON output
`);
}
