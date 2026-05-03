#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import {
	buildPortlessEnv,
	createVercelMicrofrontendsDevConfig,
	loadPortlessMfeConfig,
	resolveRuntimeIdentity,
	resolveTargetUrl,
	startPortlessProxy,
} from "../src/index.js";

const args = process.argv.slice(2);
const command = args.shift();

try {
	switch (command) {
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

async function handleDev(args) {
	const { options, commandArgs } = parseCommandArgs(args);
	if (!commandArgs.length) {
		throw new Error("Usage: portless-mfe dev -- <command> [...args]");
	}

	const config = await loadPortlessMfeConfig({
		cwd: process.cwd(),
		configPath: options.config,
	});
	const result = await createVercelMicrofrontendsDevConfig({
		cwd: config.root,
		config,
		env: process.env,
	});

	console.log(
		[
			`MFE worktree host: ${result.host}`,
			`MFE proxy port: ${result.localProxyPort}`,
			`MFE generated config: ${path.relative(config.root, result.generatedConfigPath)}`,
			...Object.entries(result.appPorts).map(([appName, port]) => `${appName} port: ${port}`),
		].join("\n"),
	);

	const child = spawn(commandArgs[0], commandArgs.slice(1), {
		cwd: config.root,
		env: {
			...process.env,
			MFE_LOCAL_PROXY_PORT: String(result.localProxyPort),
			VC_MICROFRONTENDS_CONFIG_FILE_NAME: result.packageConfigFilename,
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
	const config = await loadPortlessMfeConfig({
		cwd: process.cwd(),
		configPath: options.config,
	});
	const targetUrl = resolveTargetUrl({
		name: options.name,
		path: options.path,
		targetUrl: options.targetUrl,
		cwd: config.root,
		env: buildPortlessEnv(config, process.env),
		config,
	});

	if (options.json) {
		console.log(JSON.stringify({ targetUrl }));
		return;
	}

	console.log(targetUrl);
}

async function handleIdentity(args) {
	const { options } = parseOptions(args);
	const config = await loadPortlessMfeConfig({
		cwd: process.cwd(),
		configPath: options.config,
	});
	const targetUrl = resolveTargetUrl({
		name: options.name,
		path: options.path,
		targetUrl: options.targetUrl,
		cwd: config.root,
		env: buildPortlessEnv(config, process.env),
		config,
	});
	const identity = resolveRuntimeIdentity({
		name: options.name,
		targetUrl,
		appName: options.appName,
		cwd: config.root,
		env: process.env,
		config,
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
	const options = {};

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
  portless-mfe dev -- <command> [...args]
  portless-mfe run [--name <name>] -- <command> [...args]
  portless-mfe url [--path <path>] [--json]
  portless-mfe identity [--path <path>] [--app-name <name>] [--json]

Options:
  --config <path>       Path to portless-mfe.config.mjs
  --name <name>         Portless base route name
  --path <path>         Target path to append to the Portless URL
  --target-url <url>    Explicit target URL override
  --app-name <name>     Runtime base app name for identity
  --json                Print JSON output
`);
}
