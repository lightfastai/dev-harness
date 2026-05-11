import { resolveWorktreeIdentity } from "@lightfastai/dev-core";
import {
	formatDevProxyRuntimeSummary,
	isTurboRunCommand,
	resolvePortlessApplicationUrl,
	resolvePortlessMfeRuntime,
	resolvePortlessMfeUrl,
	signalExitCode,
	startDevProxyAppCommand,
	startDevProxyAppRuntimeCommand,
	startDevProxyDevCommand,
	startDevProxyRunCommand,
	startDevProxyRuntime,
	startDevProxyTurboCommand,
	type DevProxyProcessRuntime,
} from "@lightfastai/dev-proxy";
import {
	buildInngestDevSyncTargets,
	ensurePostgresContainer,
	ensurePostgresDatabase,
	ensureRedisServices,
	isInngestDevSyncEnabled,
	pingRedisRest,
	printDoctorReport,
	printSetupReport,
	redactPostgresUrl,
	redactRedisRestUrl,
	resolveDevPostgresConfig,
	resolveDevPostgresServiceConfig,
	resolveDevRedisConfig,
	runDevServicesDoctor,
	runDevServicesSetup,
	startInngestDevSync,
} from "@lightfastai/dev-services";

const SIGNALS: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];

interface CliOptions {
	appName?: string;
	app?: string;
	appUrls: Array<{ appName: string; url: string }>;
	configPath?: string;
	inngestSync?: boolean;
	json?: boolean;
	localApps: string[];
	mfeApps: string[];
	name?: string;
	path?: string;
	postgresTable?: string;
	servePath?: string;
	targetUrl?: string;
}

interface ParsedCommandArgs {
	options: CliOptions;
	commandArgs: string[];
}

export async function main(args: string[] = process.argv.slice(2)): Promise<void> {
	const command = args.shift();

	try {
		switch (command) {
			case "setup":
				await handleSetup(args);
				break;
			case "doctor":
				await handleDoctor(args);
				break;
			case "identity":
				handleIdentity(args);
				break;
			case "postgres":
				await handlePostgres(args);
				break;
			case "redis":
				await handleRedis(args);
				break;
			case "proxy":
				await handleProxy(args);
				break;
			case "dev":
				await handleDev(args);
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
}

async function handleSetup(args: string[]): Promise<void> {
	const { options } = parseOptions(args);
	const report = await runDevServicesSetup({
		configPath: options.configPath,
	});

	if (options.json) {
		console.log(JSON.stringify(report));
	} else {
		printSetupReport(report);
	}

	if (report.status === "fail") {
		process.exit(1);
	}
}

async function handleDoctor(args: string[]): Promise<void> {
	const { options } = parseOptions(args);
	const report = await runDevServicesDoctor({
		configPath: options.configPath,
		postgresTable: options.postgresTable,
	});

	if (options.json) {
		console.log(JSON.stringify(report));
	} else {
		printDoctorReport(report);
	}

	if (report.status === "fail") {
		process.exit(1);
	}
}

function handleIdentity(args: string[]): void {
	const { options } = parseOptions(args);
	if (!options.appName) {
		throw new Error("lightfast-dev identity requires --app-name <name>.");
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

async function handlePostgres(args: string[]): Promise<void> {
	const command = args.shift();

	switch (command) {
		case "url":
			handlePostgresUrl(args);
			break;
		case "up":
			await handlePostgresUp(args);
			break;
		case "create":
			await handlePostgresCreate(args);
			break;
		case "-h":
		case "--help":
		case undefined:
			printHelp();
			process.exit(command ? 0 : 1);
			break;
		default:
			throw new Error(`Unknown postgres command "${command}".`);
	}
}

function handlePostgresUrl(args: string[]): void {
	const { options } = parseOptions(args);
	const config = resolveDevPostgresConfig({
		cwd: process.cwd(),
		configPath: options.configPath,
		env: process.env,
	});

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
	const config = resolveDevPostgresConfig({
		cwd: process.cwd(),
		configPath: options.configPath,
		env: process.env,
	});
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

	console.log(`${created ? "Created" : "Reused"} dev Postgres database ${config.databaseName}`);
}

async function handleRedis(args: string[]): Promise<void> {
	const command = args.shift();

	switch (command) {
		case "url":
			handleRedisUrl(args);
			break;
		case "up":
			await handleRedisUp(args);
			break;
		case "ping":
			await handleRedisPing(args);
			break;
		case "-h":
		case "--help":
		case undefined:
			printHelp();
			process.exit(command ? 0 : 1);
			break;
		default:
			throw new Error(`Unknown redis command "${command}".`);
	}
}

function handleRedisUrl(args: string[]): void {
	const { options } = parseOptions(args);
	const config = resolveDevRedisConfig({
		cwd: process.cwd(),
		configPath: options.configPath,
		env: process.env,
	});

	if (options.json) {
		console.log(JSON.stringify({
			restUrl: config.restUrl,
			redactedRestUrl: redactRedisRestUrl(config.restUrl),
			redisUrl: config.redisUrl,
			keyPrefix: config.keyPrefix,
			source: config.source,
			host: config.host,
			redisPort: config.redisPort,
			restPort: config.restPort,
			redisContainerName: config.redisContainerName,
			httpContainerName: config.httpContainerName,
		}));
		return;
	}

	console.log(config.restUrl);
}

async function handleRedisUp(args: string[]): Promise<void> {
	const { options } = parseOptions(args);
	const config = resolveDevRedisConfig({
		cwd: process.cwd(),
		configPath: options.configPath,
		env: process.env,
	});
	await ensureRedisServices(config);

	if (options.json) {
		console.log(JSON.stringify({
			restUrl: config.restUrl,
			redactedRestUrl: redactRedisRestUrl(config.restUrl),
			redisUrl: config.redisUrl,
			keyPrefix: config.keyPrefix,
			source: config.source,
			networkName: config.networkName,
			redisContainerName: config.redisContainerName,
			httpContainerName: config.httpContainerName,
		}));
		return;
	}

	console.log(`Redis REST is running at ${config.restUrl} (${config.httpContainerName})`);
}

async function handleRedisPing(args: string[]): Promise<void> {
	const { options } = parseOptions(args);
	const config = resolveDevRedisConfig({
		cwd: process.cwd(),
		configPath: options.configPath,
		env: process.env,
	});
	await ensureRedisServices(config);
	const pong = await pingRedisRest(config);

	if (options.json) {
		console.log(JSON.stringify({
			restUrl: config.restUrl,
			redactedRestUrl: redactRedisRestUrl(config.restUrl),
			keyPrefix: config.keyPrefix,
			pong,
		}));
		return;
	}

	console.log(pong);
}

async function handleProxy(args: string[]): Promise<void> {
	const command = args.shift();

	switch (command) {
		case "url":
			handleProxyUrl(args);
			break;
		case "identity":
			handleProxyIdentity(args);
			break;
		case "start":
			await handleProxyStart(args);
			break;
		case "dev":
			await handleProxyDev(args);
			break;
		case "turbo":
			await handleProxyTurbo(args);
			break;
		case "run":
			await handleProxyRun(args);
			break;
		case "app":
			await handleProxyApp(args);
			break;
		case "app-runtime":
			await handleProxyAppRuntime(args);
			break;
		case "-h":
		case "--help":
		case undefined:
			printHelp();
			process.exit(command ? 0 : 1);
			break;
		default:
			throw new Error(`Unknown proxy command "${command}".`);
	}
}

function handleProxyUrl(args: string[]): void {
	const { options } = parseOptions(args);
	const targetUrl = options.app
		? resolvePortlessApplicationUrl({
			app: options.app,
			path: options.path,
			targetUrl: options.targetUrl,
			cwd: process.cwd(),
			env: process.env,
			configPath: options.configPath,
		})
		: resolvePortlessMfeUrl({
			name: options.name,
			path: options.path,
			targetUrl: options.targetUrl,
			cwd: process.cwd(),
			env: process.env,
			configPath: options.configPath,
		});

	if (options.json) {
		console.log(JSON.stringify({ targetUrl }));
		return;
	}

	console.log(targetUrl);
}

function handleProxyIdentity(args: string[]): void {
	const { options } = parseOptions(args);
	const identity = resolvePortlessMfeRuntime({
		name: options.name,
		path: options.path,
		targetUrl: options.targetUrl,
		appName: options.appName,
		env: process.env,
		cwd: process.cwd(),
		configPath: options.configPath,
	});

	if (options.json) {
		console.log(JSON.stringify(identity));
		return;
	}

	console.log(identity.name);
}

async function handleProxyStart(args: string[]): Promise<void> {
	const { options } = parseOptions(args);
	const runtime = await startDevProxyRuntime({
		configPath: options.configPath,
		localApps: options.localApps,
	});
	console.log(formatDevProxyRuntimeSummary(runtime));
	await waitForRuntime(runtime);
}

async function handleProxyDev(args: string[]): Promise<void> {
	const { options, commandArgs } = parseCommandArgs(args);
	if (!commandArgs.length) {
		throw new Error("Usage: lightfast-dev proxy dev [options] -- <command> [...args]");
	}

	const runtime = await startDevProxyDevCommand({
		configPath: options.configPath,
		localApps: options.localApps,
		commandArgs,
	});
	console.log(formatDevProxyRuntimeSummary(runtime));
	await waitForRuntime(runtime);
}

async function handleProxyTurbo(args: string[]): Promise<void> {
	const { options, commandArgs } = parseLeadingProxyArgs(args);
	if (!commandArgs.length) {
		throw new Error("Usage: lightfast-dev proxy turbo [options] run dev [...turbo args]");
	}

	const runtime = await startDevProxyTurboCommand({
		configPath: options.configPath,
		name: options.name,
		localApps: options.localApps,
		commandArgs,
	});
	await waitForRuntime(runtime);
}

async function handleProxyRun(args: string[]): Promise<void> {
	const { options, commandArgs } = parseCommandArgs(args);
	if (!commandArgs.length) {
		throw new Error("Usage: lightfast-dev proxy run [options] -- <command> [...args]");
	}

	const runtime = await startDevProxyRunCommand({
		configPath: options.configPath,
		name: options.name,
		localApps: options.localApps,
		commandArgs,
	});
	await waitForRuntime(runtime);
}

async function handleProxyApp(args: string[]): Promise<void> {
	const { options, commandArgs } = parseCommandArgs(args);
	if (!commandArgs.length) {
		throw new Error("Usage: lightfast-dev proxy app [options] -- <command> [...args]");
	}

	const runtime = await startDevProxyAppCommand({
		configPath: options.configPath,
		commandArgs,
	});
	await waitForRuntime(runtime);
}

async function handleProxyAppRuntime(args: string[]): Promise<void> {
	const { commandArgs } = parseCommandArgs(args);
	if (!commandArgs.length) {
		throw new Error("Usage: lightfast-dev proxy app-runtime -- <command> [...args]");
	}

	const runtime = startDevProxyAppRuntimeCommand({ commandArgs });
	await waitForRuntime(runtime);
}

async function handleDev(args: string[]): Promise<void> {
	const { options, commandArgs } = parseCommandArgs(args);
	if (!commandArgs.length) {
		throw new Error("Usage: lightfast-dev dev [options] -- <command> [...args]");
	}

	const targets = options.inngestSync === false || !isInngestDevSyncEnabled(process.env)
		? []
		: resolveInngestTargets(options);
	const syncRuntime = startInngestDevSync({
		targets,
		enabled: targets.length > 0,
	});

	try {
		const runtime = isTurboRunCommand(commandArgs)
			? await startDevProxyTurboCommand({
				configPath: options.configPath,
				localApps: options.mfeApps,
				commandArgs,
			})
			: await startDevProxyRunCommand({
				configPath: options.configPath,
				localApps: options.mfeApps,
				commandArgs,
			});

		await waitForRuntime(runtime, () => syncRuntime.stop());
	} catch (error) {
		syncRuntime.stop();
		throw error;
	}
}

function resolveInngestTargets(options: CliOptions) {
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

	const appUrls = Object.fromEntries(
		options.mfeApps.map((appName) => [
			appName,
			resolvePortlessApplicationUrl({
				app: appName,
				cwd: process.cwd(),
				env: process.env,
				configPath: options.configPath,
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

async function waitForRuntime(
	runtime: DevProxyProcessRuntime,
	onStop?: () => void,
): Promise<void> {
	let pressed = false;
	let onStopCalled = false;
	const callOnStop = () => {
		if (onStopCalled) return;
		onStopCalled = true;
		onStop?.();
	};
	const shutdown = (signal: NodeJS.Signals) => {
		callOnStop();
		runtime.stop(signal);
		if (pressed) {
			console.error(`\n[lightfast-dev] received ${signal} twice — force killing.`);
		}
		pressed = true;
	};
	for (const signal of SIGNALS) {
		process.on(signal, () => shutdown(signal));
	}
	const result = await runtime.exit;
	callOnStop();
	process.exit(result.exitCode);
}

function parseCommandArgs(args: string[]): ParsedCommandArgs {
	const separatorIndex = args.indexOf("--");
	const optionArgs = separatorIndex === -1 ? [] : args.slice(0, separatorIndex);
	const commandArgs = separatorIndex === -1 ? args : args.slice(separatorIndex + 1);
	const { options } = parseOptions(optionArgs);
	return { options, commandArgs };
}

function parseLeadingProxyArgs(args: string[]): ParsedCommandArgs {
	const options = createOptions();
	let index = 0;

	for (; index < args.length; index++) {
		const arg = args[index];
		switch (arg) {
			case "--config":
				options.configPath = readOptionValue(args, ++index, arg);
				break;
			case "--name":
				options.name = readOptionValue(args, ++index, arg);
				break;
			case "--local-app":
				options.localApps.push(readOptionValue(args, ++index, arg));
				break;
			case "-h":
			case "--help":
				printHelp();
				process.exit(0);
				break;
			default:
				return { options, commandArgs: args.slice(index) };
		}
	}

	return { options, commandArgs: [] };
}

function parseOptions(args: string[]): { options: CliOptions } {
	const options = createOptions();

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];

		switch (arg) {
			case "--app":
				options.app = readOptionValue(args, ++i, arg);
				break;
			case "--app-name":
				options.appName = readOptionValue(args, ++i, arg);
				break;
			case "--app-url":
				options.appUrls.push(parseAppUrl(readOptionValue(args, ++i, arg)));
				break;
			case "--config":
				options.configPath = readOptionValue(args, ++i, arg);
				break;
			case "--json":
				options.json = true;
				break;
			case "--local-app":
				options.localApps.push(readOptionValue(args, ++i, arg));
				break;
			case "--mfe-app":
				options.mfeApps.push(readOptionValue(args, ++i, arg));
				break;
			case "--name":
				options.name = readOptionValue(args, ++i, arg);
				break;
			case "--no-inngest-sync":
				options.inngestSync = false;
				break;
			case "--path":
				options.path = readOptionValue(args, ++i, arg);
				break;
			case "--postgres-table":
				options.postgresTable = readOptionValue(args, ++i, arg);
				break;
			case "--serve-path":
				options.servePath = readOptionValue(args, ++i, arg);
				break;
			case "--target-url":
				options.targetUrl = readOptionValue(args, ++i, arg);
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

function createOptions(): CliOptions {
	return {
		appUrls: [],
		localApps: [],
		mfeApps: [],
	};
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

function printHelp(): void {
	console.log(`Usage:
  lightfast-dev setup [--config <path>] [--json]
  lightfast-dev doctor [--config <path>] [--postgres-table <name>] [--json]
  lightfast-dev identity --app-name <name> [--json]
  lightfast-dev dev [--mfe-app <name>] [--app-url <name=url>] -- <command> [...args]

  lightfast-dev postgres url [--config <path>] [--json]
  lightfast-dev postgres up [--json]
  lightfast-dev postgres create [--config <path>] [--json]

  lightfast-dev redis url [--config <path>] [--json]
  lightfast-dev redis up [--config <path>] [--json]
  lightfast-dev redis ping [--config <path>] [--json]

  lightfast-dev proxy url [--app <name>] [--path <path>] [--json]
  lightfast-dev proxy identity [--path <path>] [--app-name <name>] [--json]
  lightfast-dev proxy start [--local-app <name>]
  lightfast-dev proxy dev [--local-app <name>] -- <command> [...args]
  lightfast-dev proxy turbo [--name <name>] [--local-app <name>] run dev [...turbo args]
  lightfast-dev proxy run [--name <name>] [--local-app <name>] -- <command> [...args]
  lightfast-dev proxy app -- <command> [...args]

Options:
  --config <path>       Path to lightfast.dev.json
  --mfe-app <name>      Resolve a Portless MFE app URL for Inngest sync
  --app-url <name=url>  Explicit app URL to sync into the Inngest Dev Server
  --local-app <name>    Locally running Vercel Microfrontends application
  --serve-path <path>   Inngest serve route path. Default: /api/inngest
  --no-inngest-sync     Run wrapped dev command without Inngest endpoint sync
  --json                Print JSON output where supported
`);
}

export { signalExitCode };
