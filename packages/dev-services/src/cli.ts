#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { resolveWorktreeIdentity } from "@lightfastai/dev-core";
import {
	buildInngestDevSyncTargets,
	type DevPostgresConfig,
	type DevPostgresServiceConfig,
	isInngestDevSyncEnabled,
	redactPostgresUrl,
	resolveDevPostgresConfig,
	resolveDevPostgresServiceConfig,
	startInngestDevSync,
} from "./public.js";

const SIGNALS: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];

interface CliOptions {
	appName?: string;
	baseName?: string;
	json?: boolean;
	mfeApps: string[];
	appUrls: Array<{ appName: string; url: string }>;
	servePath?: string;
	inngestSync?: boolean;
}

interface ParsedCommandArgs {
	options: CliOptions;
	commandArgs: string[];
}

const args = process.argv.slice(2);
const command = args.shift();

try {
	switch (command) {
		case "identity":
			handleIdentity(args);
			break;
		case "inngest-sync":
			await handleInngestSync(args);
			break;
		case "postgres-url":
			handlePostgresUrl(args);
			break;
		case "postgres-up":
			await handlePostgresUp(args);
			break;
		case "postgres-create":
			await handlePostgresCreate(args);
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

function handleIdentity(args: string[]): void {
	const { options } = parseOptions(args);
	if (!options.appName) {
		throw new Error("lightfast-dev-services identity requires --app-name <name>.");
	}

	const identity = resolveWorktreeIdentity({
		baseName: options.appName,
		cwd: process.cwd(),
	});

	if (options.json) {
		console.log(JSON.stringify(identity));
		return;
	}

	console.log(identity.name);
}

async function handleInngestSync(args: string[]): Promise<void> {
	const { options, commandArgs } = parseCommandArgs(args);
	if (!commandArgs.length) {
		throw new Error("Usage: lightfast-dev-services inngest-sync [options] -- <command> [...args]");
	}

	const targets = options.inngestSync === false || !isInngestDevSyncEnabled(process.env)
		? []
		: await resolveInngestTargets(options);
	const syncRuntime = startInngestDevSync({
		targets,
		enabled: targets.length > 0,
	});
	const child = spawn(commandArgs[0], commandArgs.slice(1), {
		cwd: process.cwd(),
		env: process.env,
		stdio: "inherit",
	});
	let shuttingDown = false;

	const shutdown = (signal: NodeJS.Signals) => {
		shuttingDown = true;
		syncRuntime.stop();
		if (!child.killed) {
			child.kill(signal);
		}
	};

	for (const signal of SIGNALS) {
		process.on(signal, () => shutdown(signal));
	}

	child.on("exit", (code, signal) => {
		if (!shuttingDown) {
			syncRuntime.stop();
		}
		if (signal) {
			process.exit(signalExitCode(signal));
			return;
		}
		process.exit(code ?? 0);
	});
}

function handlePostgresUrl(args: string[]): void {
	const { options } = parseOptions(args);
	const config = resolvePostgresConfigFromOptions(options);

	if (options.json) {
		console.log(JSON.stringify({
			databaseName: config.databaseName,
			databaseUrl: config.databaseUrl,
			redactedDatabaseUrl: redactPostgresUrl(config.databaseUrl),
			source: config.source,
			host: config.host,
			port: config.port,
			containerName: config.containerName,
		}));
		return;
	}

	console.log(config.databaseUrl);
}

async function handlePostgresUp(args: string[]): Promise<void> {
	const { options } = parseOptions(args);
	const service = resolveDevPostgresServiceConfig(process.env);
	await ensurePostgresContainer(service);

	if (options.json) {
		console.log(JSON.stringify({
			containerName: service.containerName,
			image: service.image,
			host: service.host,
			port: service.port,
			volumeName: service.volumeName,
		}));
		return;
	}

	console.log(`Postgres is running at ${service.host}:${service.port} (${service.containerName})`);
}

async function handlePostgresCreate(args: string[]): Promise<void> {
	const { options } = parseOptions(args);
	const config = resolvePostgresConfigFromOptions(options);
	await ensurePostgresContainer(config);
	const created = await ensurePostgresDatabase(config);

	if (options.json) {
		console.log(JSON.stringify({
			databaseName: config.databaseName,
			databaseUrl: config.databaseUrl,
			redactedDatabaseUrl: redactPostgresUrl(config.databaseUrl),
			created,
		}));
		return;
	}

	console.log(
		`${created ? "Created" : "Reused"} dev Postgres database ${config.databaseName}`,
	);
}

async function resolveInngestTargets(options: CliOptions) {
	const explicitTargets = buildInngestDevSyncTargets({
		result: {
			appUrls: Object.fromEntries(
				options.appUrls.map(({ appName, url }) => [appName, url]),
			),
			localAppNames: options.appUrls.map(({ appName }) => appName),
		},
		servePath: options.servePath,
	});

	if (!options.mfeApps.length) {
		return explicitTargets;
	}

	const relatedProjects = await loadRelatedProjectsApi();
	const appUrls = Object.fromEntries(
		options.mfeApps.map((appName) => [
			appName,
			relatedProjects.resolvePortlessApplicationUrl({
				app: appName,
				cwd: process.cwd(),
				env: process.env,
			}),
		]),
	);

	return [
		...explicitTargets,
		...buildInngestDevSyncTargets({
			result: {
				appUrls,
				localAppNames: options.mfeApps,
			},
			servePath: options.servePath,
		}),
	];
}

async function loadRelatedProjectsApi(): Promise<{
	resolvePortlessApplicationUrl(options: {
		app: string;
		cwd?: string;
		env?: Record<string, string | undefined>;
	}): string;
}> {
	const moduleName = "@lightfastai/related-projects";
	try {
		return await import(moduleName) as {
			resolvePortlessApplicationUrl(options: {
				app: string;
				cwd?: string;
				env?: Record<string, string | undefined>;
			}): string;
		};
	} catch (error) {
		throw new Error(
			`Unable to resolve MFE app URLs. Install/build @lightfastai/related-projects or pass --app-url <name=url>. ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

function parseCommandArgs(args: string[]): ParsedCommandArgs {
	const separatorIndex = args.indexOf("--");
	const optionArgs = separatorIndex === -1 ? [] : args.slice(0, separatorIndex);
	const commandArgs = separatorIndex === -1 ? args : args.slice(separatorIndex + 1);
	const { options } = parseOptions(optionArgs);
	return { options, commandArgs };
}

function parseOptions(args: string[]): { options: CliOptions } {
	const options: CliOptions = { mfeApps: [], appUrls: [] };

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];

		switch (arg) {
			case "--app-name":
				options.appName = readOptionValue(args, ++i, arg);
				break;
			case "--base-name":
				options.baseName = readOptionValue(args, ++i, arg);
				break;
			case "--mfe-app":
				options.mfeApps.push(readOptionValue(args, ++i, arg));
				break;
			case "--app-url":
				options.appUrls.push(parseAppUrl(readOptionValue(args, ++i, arg)));
				break;
			case "--serve-path":
				options.servePath = readOptionValue(args, ++i, arg);
				break;
			case "--no-inngest-sync":
				options.inngestSync = false;
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

function parseAppUrl(value: string): { appName: string; url: string } {
	const separatorIndex = value.indexOf("=");
	if (separatorIndex > 0) {
		return {
			appName: value.slice(0, separatorIndex),
			url: value.slice(separatorIndex + 1),
		};
	}

	const hostname = new URL(value).hostname;
	return {
		appName: hostname.split(".")[0] || hostname,
		url: value,
	};
}

function readOptionValue(args: string[], index: number, option: string): string {
	const value = args[index];
	if (!value || value.startsWith("--")) {
		throw new Error(`${option} requires a value.`);
	}
	return value;
}

function resolvePostgresConfigFromOptions(options: CliOptions): DevPostgresConfig {
	if (!options.baseName) {
		throw new Error("Postgres commands require --base-name <name>.");
	}

	return resolveDevPostgresConfig({
		baseName: options.baseName,
		cwd: process.cwd(),
		env: process.env,
	});
}

async function ensurePostgresContainer(service: DevPostgresServiceConfig): Promise<void> {
	const state = inspectDockerContainer(service.containerName);

	if (state === "running") {
		await waitForPostgres(service);
		return;
	}

	if (state === "stopped") {
		runDocker(["start", service.containerName], `Unable to start Docker container ${service.containerName}.`);
		await waitForPostgres(service);
		return;
	}

	runDocker(
		[
			"run",
			"--name",
			service.containerName,
			"-e",
			`POSTGRES_USER=${service.username}`,
			"-e",
			`POSTGRES_PASSWORD=${service.password}`,
			"-p",
			`${service.port}:5432`,
			"-v",
			`${service.volumeName}:/var/lib/postgresql/data`,
			"-d",
			service.image,
		],
		`Unable to create Docker container ${service.containerName}.`,
	);
	await waitForPostgres(service);
}

async function ensurePostgresDatabase(config: DevPostgresConfig): Promise<boolean> {
	const exists = runDocker(
		[
			"exec",
			config.containerName,
			"psql",
			"-U",
			config.username,
			"-d",
			"postgres",
			"-tAc",
			`SELECT 1 FROM pg_database WHERE datname = '${config.databaseName.replace(/'/g, "''")}'`,
		],
		`Unable to inspect Postgres database ${config.databaseName}.`,
	).trim() === "1";

	if (exists) {
		return false;
	}

	runDocker(
		[
			"exec",
			config.containerName,
			"createdb",
			"-U",
			config.username,
			config.databaseName,
		],
		`Unable to create Postgres database ${config.databaseName}.`,
	);
	return true;
}

function inspectDockerContainer(containerName: string): "missing" | "running" | "stopped" {
	const result = spawnSync(
		"docker",
		["inspect", "-f", "{{.State.Running}}", containerName],
		{
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		},
	);

	if (result.error) {
		throw result.error;
	}
	if (result.status !== 0) {
		return "missing";
	}

	return result.stdout.trim() === "true" ? "running" : "stopped";
}

async function waitForPostgres(service: DevPostgresServiceConfig): Promise<void> {
	let lastError = "";

	for (let attempt = 0; attempt < 40; attempt++) {
		const result = spawnSync(
			"docker",
			[
				"exec",
				service.containerName,
				"pg_isready",
				"-U",
				service.username,
				"-d",
				"postgres",
			],
			{
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			},
		);

		if (result.status === 0) {
			return;
		}
		lastError = result.stderr || result.stdout;
		await new Promise((resolve) => setTimeout(resolve, 500));
	}

	throw new Error(`Timed out waiting for ${service.containerName} to accept Postgres connections. ${lastError.trim()}`);
}

function runDocker(args: string[], errorMessage: string): string {
	const result = spawnSync("docker", args, {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});

	if (result.error) {
		throw result.error;
	}
	if (result.status !== 0) {
		throw new Error(`${errorMessage}\n${result.stderr || result.stdout}`);
	}

	return result.stdout;
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

function printHelp(): void {
	console.log(`Usage:
  lightfast-dev-services identity --app-name <name> [--json]
  lightfast-dev-services inngest-sync [--mfe-app <name>] [--app-url <name=url>] -- <command> [...args]
  lightfast-dev-services postgres-url --base-name <name> [--json]
  lightfast-dev-services postgres-up [--json]
  lightfast-dev-services postgres-create --base-name <name> [--json]

Options:
  --app-name <name>     Runtime base app name for identity
  --base-name <name>    Base name for derived worktree database names
  --mfe-app <name>      Resolve a Portless MFE app URL through @lightfastai/related-projects
  --app-url <name=url>  Explicit app URL to sync into the Inngest Dev Server
  --serve-path <path>   Inngest serve route path. Default: /api/inngest
  --no-inngest-sync     Run the wrapped command without Inngest endpoint sync
  --json                Print JSON output where supported
`);
}
