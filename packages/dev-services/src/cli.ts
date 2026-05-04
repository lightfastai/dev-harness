#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { resolveDevProjectConfig, resolveWorktreeIdentity } from "@lightfastai/dev-core";
import {
	buildInngestDevSyncTargets,
	type DevPostgresConfig,
	type DevPostgresServiceConfig,
	type DevRedisConfig,
	type DevRedisServiceConfig,
	isInngestDevSyncEnabled,
	redactPostgresUrl,
	redactRedisRestUrl,
	resolveDevPostgresConfig,
	resolveDevPostgresServiceConfig,
	resolveDevRedisConfig,
	resolveDevRedisServiceConfig,
	startInngestDevSync,
} from "./public.js";

const SIGNALS: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];

interface CliOptions {
	appName?: string;
	configPath?: string;
	json?: boolean;
	postgresTable?: string;
	mfeApps: string[];
	appUrls: Array<{ appName: string; url: string }>;
	servePath?: string;
	inngestSync?: boolean;
}

interface ParsedCommandArgs {
	options: CliOptions;
	commandArgs: string[];
}

type CheckStatus = "pass" | "fail" | "skip";

interface DevServiceCheck {
	name: string;
	status: CheckStatus;
	message?: string;
	remediation?: string;
}

interface ProjectReport {
	name: string;
	root: string;
	configPath: string;
}

interface PostgresReport {
	databaseName: string;
	redactedDatabaseUrl: string;
	host: string;
	port: number;
	containerName: string;
	created?: boolean;
	checks: DevServiceCheck[];
}

interface RedisReport {
	restUrl: string;
	redactedRestUrl: string;
	keyPrefix: string;
	redisContainerName: string;
	httpContainerName: string;
	checks: DevServiceCheck[];
}

interface DevServicesReport {
	status: "ok" | "fail";
	project: ProjectReport | null;
	postgres: PostgresReport | null;
	redis: RedisReport | null;
	failures: string[];
}

const args = process.argv.slice(2);
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
		case "redis-url":
			handleRedisUrl(args);
			break;
		case "redis-up":
			await handleRedisUp(args);
			break;
		case "redis-ping":
			await handleRedisPing(args);
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

async function handleSetup(args: string[]): Promise<void> {
	const { options } = parseOptions(args);
	const report = await runSetup(options);

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
	const report = await runDoctor(options);

	if (options.json) {
		console.log(JSON.stringify(report));
	} else {
		printDoctorReport(report);
	}

	if (report.status === "fail") {
		process.exit(1);
	}
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

function handleRedisUrl(args: string[]): void {
	const { options } = parseOptions(args);
	const config = resolveRedisConfigFromOptions(options);

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
	const config = resolveRedisConfigFromOptions(options);
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
	const config = resolveRedisConfigFromOptions(options);
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

async function runSetup(options: CliOptions): Promise<DevServicesReport> {
	const report = createReport();

	try {
		const project = resolveProjectFromOptions(options);
		const postgres = resolvePostgresConfigFromOptions(options);
		const redis = resolveRedisConfigFromOptions(options);
		report.project = formatProjectReport(project);
		report.postgres = formatPostgresReport(postgres);
		report.redis = formatRedisReport(redis);

		await ensurePostgresContainer(postgres);
		addCheck(report.postgres, {
			name: "postgres-container",
			status: "pass",
			message: `${postgres.containerName} is running at ${postgres.host}:${postgres.port}`,
		});

		const created = await ensurePostgresDatabase(postgres);
		report.postgres.created = created;
		addCheck(report.postgres, {
			name: "postgres-database",
			status: "pass",
			message: `${created ? "Created" : "Reused"} database ${postgres.databaseName}`,
		});

		await ensureRedisServices(redis);
		addCheck(report.redis, {
			name: "redis-services",
			status: "pass",
			message: `${redis.httpContainerName} is serving ${redis.restUrl}`,
		});

		const pong = await pingRedisRest(redis);
		addCheck(report.redis, {
			name: "redis-ping",
			status: "pass",
			message: pong,
		});
	} catch (error) {
		recordFailure(report, error instanceof Error ? error.message : String(error));
	}

	finalizeReport(report);
	return report;
}

async function runDoctor(options: CliOptions): Promise<DevServicesReport> {
	const report = createReport();
	const dockerAvailable = checkDockerAvailable(report);
	let postgresConfig: DevPostgresConfig;
	let redisConfig: DevRedisConfig;

	try {
		const project = resolveProjectFromOptions(options);
		postgresConfig = resolvePostgresConfigFromOptions(options);
		redisConfig = resolveRedisConfigFromOptions(options);
		report.project = formatProjectReport(project);
		report.postgres = formatPostgresReport(postgresConfig);
		report.redis = formatRedisReport(redisConfig);
	} catch (error) {
		recordFailure(report, error instanceof Error ? error.message : String(error), "Run from a repo containing related-projects.json or pass --config <path>.");
		finalizeReport(report);
		return report;
	}

	if (report.postgres) {
		checkPostgresDoctor(report, report.postgres, postgresConfig, dockerAvailable, options.postgresTable);
	}

	if (report.redis) {
		await checkRedisDoctor(report, report.redis, redisConfig, dockerAvailable);
	}

	finalizeReport(report);
	return report;
}

function createReport(): DevServicesReport {
	return {
		status: "ok",
		project: null,
		postgres: null,
		redis: null,
		failures: [],
	};
}

function finalizeReport(report: DevServicesReport): void {
	report.status = report.failures.length ? "fail" : "ok";
}

function formatProjectReport(project: ReturnType<typeof resolveDevProjectConfig>): ProjectReport {
	return {
		name: project.name,
		root: project.root,
		configPath: project.configPath,
	};
}

function formatPostgresReport(config: DevPostgresConfig): PostgresReport {
	return {
		databaseName: config.databaseName,
		redactedDatabaseUrl: redactPostgresUrl(config.databaseUrl),
		host: config.host,
		port: config.port,
		containerName: config.containerName,
		checks: [],
	};
}

function formatRedisReport(config: DevRedisConfig): RedisReport {
	return {
		restUrl: config.restUrl,
		redactedRestUrl: redactRedisRestUrl(config.restUrl),
		keyPrefix: config.keyPrefix,
		redisContainerName: config.redisContainerName,
		httpContainerName: config.httpContainerName,
		checks: [],
	};
}

function addCheck(target: { checks: DevServiceCheck[] }, check: DevServiceCheck): void {
	target.checks.push(check);
}

function recordFailure(report: DevServicesReport, message: string, remediation?: string): void {
	const fullMessage = remediation ? `${message} ${remediation}` : message;
	if (!report.failures.includes(fullMessage)) {
		report.failures.push(fullMessage);
	}
}

function addFailedCheck(
	report: DevServicesReport,
	target: { checks: DevServiceCheck[] },
	check: Omit<DevServiceCheck, "status">,
): void {
	const failedCheck = { ...check, status: "fail" as const };
	addCheck(target, failedCheck);
	recordFailure(report, check.message ?? check.name, check.remediation);
}

function resolveProjectFromOptions(options: CliOptions) {
	return resolveDevProjectConfig({
		cwd: process.cwd(),
		configPath: options.configPath,
	});
}

function checkDockerAvailable(report: DevServicesReport): boolean {
	const result = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});

	if (result.status === 0) {
		return true;
	}

	recordFailure(
		report,
		`Docker is not available. ${formatSpawnFailure(result)}`,
		"Start Docker, then run pnpm dev:setup.",
	);
	return false;
}

function checkPostgresDoctor(
	report: DevServicesReport,
	target: PostgresReport,
	config: DevPostgresConfig,
	dockerAvailable: boolean,
	postgresTable?: string,
): void {
	if (!dockerAvailable) {
		addFailedCheck(report, target, {
			name: "postgres-container",
			message: "Skipped Postgres checks because Docker is not available.",
			remediation: "Start Docker, then run pnpm dev:setup.",
		});
		addSkippedPostgresChecks(target, postgresTable, "Docker is not available.");
		return;
	}

	const state = inspectDockerContainer(config.containerName);
	if (state !== "running") {
		addFailedCheck(report, target, {
			name: "postgres-container",
			message: `${config.containerName} is ${state}.`,
			remediation: "Run pnpm dev:setup.",
		});
		addSkippedPostgresChecks(target, postgresTable, "Postgres container is not running.");
		return;
	}

	addCheck(target, {
		name: "postgres-container",
		status: "pass",
		message: `${config.containerName} is running.`,
	});

	if (!checkPostgresReady(report, target, config)) {
		addSkippedPostgresChecks(target, postgresTable, "Postgres is not accepting connections.");
		return;
	}

	if (!checkPostgresDatabase(report, target, config)) {
		if (postgresTable) {
			addCheck(target, {
				name: `postgres-table:${postgresTable}`,
				status: "skip",
				message: "Database does not exist.",
			});
		}
		return;
	}

	if (postgresTable) {
		checkPostgresTable(report, target, config, postgresTable);
	}
}

function checkPostgresReady(
	report: DevServicesReport,
	target: PostgresReport,
	config: DevPostgresConfig,
): boolean {
	const result = runDockerStatus([
		"exec",
		config.containerName,
		"pg_isready",
		"-U",
		config.username,
		"-d",
		"postgres",
	]);

	if (result.status === 0) {
		addCheck(target, {
			name: "postgres-ready",
			status: "pass",
			message: "Postgres accepts connections.",
		});
		return true;
	}

	addFailedCheck(report, target, {
		name: "postgres-ready",
		message: `Postgres is not ready. ${formatSpawnFailure(result)}`,
		remediation: "Run pnpm dev:setup.",
	});
	return false;
}

function checkPostgresDatabase(
	report: DevServicesReport,
	target: PostgresReport,
	config: DevPostgresConfig,
): boolean {
	const result = runDockerStatus([
		"exec",
		config.containerName,
		"psql",
		"-U",
		config.username,
		"-d",
		"postgres",
		"-tAc",
		`SELECT 1 FROM pg_database WHERE datname = '${config.databaseName.replace(/'/g, "''")}'`,
	]);

	if (result.status === 0 && spawnOutput(result.stdout).trim() === "1") {
		addCheck(target, {
			name: "postgres-database",
			status: "pass",
			message: `${config.databaseName} exists.`,
		});
		return true;
	}

	addFailedCheck(report, target, {
		name: "postgres-database",
		message: `${config.databaseName} does not exist.`,
		remediation: "Run pnpm dev:setup.",
	});
	return false;
}

function checkPostgresTable(
	report: DevServicesReport,
	target: PostgresReport,
	config: DevPostgresConfig,
	postgresTable: string,
): void {
	if (!isSafeQualifiedIdentifier(postgresTable)) {
		addFailedCheck(report, target, {
			name: `postgres-table:${postgresTable}`,
			message: `Invalid Postgres table name "${postgresTable}".`,
		});
		return;
	}

	const result = runDockerStatus([
		"exec",
		config.containerName,
		"psql",
		"-U",
		config.username,
		"-d",
		config.databaseName,
		"-tAc",
		`SELECT to_regclass('${postgresTable.replace(/'/g, "''")}') IS NOT NULL`,
	]);

	if (result.status === 0 && spawnOutput(result.stdout).trim() === "t") {
		addCheck(target, {
			name: `postgres-table:${postgresTable}`,
			status: "pass",
			message: `${postgresTable} exists.`,
		});
		return;
	}

	addFailedCheck(report, target, {
		name: `postgres-table:${postgresTable}`,
		message: `${postgresTable} is missing.`,
		remediation: "Run pnpm db:migrate.",
	});
}

function addSkippedPostgresChecks(target: PostgresReport, postgresTable: string | undefined, message: string): void {
	addCheck(target, {
		name: "postgres-ready",
		status: "skip",
		message,
	});
	addCheck(target, {
		name: "postgres-database",
		status: "skip",
		message,
	});
	if (postgresTable) {
		addCheck(target, {
			name: `postgres-table:${postgresTable}`,
			status: "skip",
			message,
		});
	}
}

async function checkRedisDoctor(
	report: DevServicesReport,
	target: RedisReport,
	config: DevRedisConfig,
	dockerAvailable: boolean,
): Promise<void> {
	if (config.source === "env") {
		addCheck(target, {
			name: "redis-services",
			status: "skip",
			message: "Redis uses env-backed REST config.",
		});
		await checkRedisPing(report, target, config);
		return;
	}

	if (!dockerAvailable) {
		addFailedCheck(report, target, {
			name: "redis-services",
			message: "Skipped Redis checks because Docker is not available.",
			remediation: "Start Docker, then run pnpm dev:setup.",
		});
		addCheck(target, {
			name: "redis-ping",
			status: "skip",
			message: "Docker is not available.",
		});
		return;
	}

	const redisState = inspectDockerContainer(config.redisContainerName);
	const httpState = inspectDockerContainer(config.httpContainerName);
	if (redisState !== "running" || httpState !== "running") {
		addFailedCheck(report, target, {
			name: "redis-services",
			message: `${config.redisContainerName} is ${redisState}; ${config.httpContainerName} is ${httpState}.`,
			remediation: "Run pnpm dev:setup.",
		});
		addCheck(target, {
			name: "redis-ping",
			status: "skip",
			message: "Redis services are not running.",
		});
		return;
	}

	addCheck(target, {
		name: "redis-services",
		status: "pass",
		message: `${config.redisContainerName} and ${config.httpContainerName} are running.`,
	});
	await checkRedisPing(report, target, config);
}

async function checkRedisPing(
	report: DevServicesReport,
	target: RedisReport,
	config: DevRedisConfig,
): Promise<void> {
	try {
		const pong = await pingRedisRest(config);
		addCheck(target, {
			name: "redis-ping",
			status: "pass",
			message: pong,
		});
	} catch (error) {
		addFailedCheck(report, target, {
			name: "redis-ping",
			message: `Redis REST ping failed. ${error instanceof Error ? error.message : String(error)}`,
			remediation: "Run pnpm dev:setup.",
		});
	}
}

function runDockerStatus(args: string[]): ReturnType<typeof spawnSync> {
	return spawnSync("docker", args, {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
}

function formatSpawnFailure(result: ReturnType<typeof spawnSync>): string {
	if (result.error) {
		return result.error.message;
	}
	return (spawnOutput(result.stderr) || spawnOutput(result.stdout) || `exit ${result.status ?? "unknown"}`).trim();
}

function spawnOutput(value: string | NodeJS.ArrayBufferView | null | undefined): string {
	return typeof value === "string" ? value : value?.toString() ?? "";
}

function isSafeQualifiedIdentifier(value: string): boolean {
	return /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/.test(value);
}

function printSetupReport(report: DevServicesReport): void {
	if (report.status === "ok") {
		console.log("Dev services are ready.");
		printResolvedServices(report);
		return;
	}

	printFailures(report);
}

function printDoctorReport(report: DevServicesReport): void {
	if (report.status === "ok") {
		console.log("Dev services doctor passed.");
		printResolvedServices(report);
		return;
	}

	printFailures(report);
}

function printResolvedServices(report: DevServicesReport): void {
	if (report.project) {
		console.log(`Project: ${report.project.name} (${report.project.root})`);
	}
	if (report.postgres) {
		console.log(`Postgres: ${report.postgres.databaseName} at ${report.postgres.host}:${report.postgres.port}`);
	}
	if (report.redis) {
		console.log(`Redis REST: ${report.redis.restUrl}`);
		console.log(`Redis key prefix: ${report.redis.keyPrefix}`);
	}
}

function printFailures(report: DevServicesReport): void {
	console.error("Dev services check failed.");
	for (const failure of report.failures) {
		console.error(`- ${failure}`);
	}
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
			case "--config":
				options.configPath = readOptionValue(args, ++i, arg);
				break;
			case "--postgres-table":
				options.postgresTable = readOptionValue(args, ++i, arg);
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
	return resolveDevPostgresConfig({
		cwd: process.cwd(),
		configPath: options.configPath,
		env: process.env,
	});
}

function resolveRedisConfigFromOptions(options: CliOptions): DevRedisConfig {
	return resolveDevRedisConfig({
		cwd: process.cwd(),
		configPath: options.configPath,
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

async function ensureRedisServices(config: DevRedisConfig): Promise<void> {
	if (config.source === "env") {
		await waitForRedisRest(config);
		return;
	}

	ensureDockerNetwork(config.networkName);
	await ensureRedisContainer(config);
	await ensureRedisHttpContainer(config);
	await waitForRedisRest(config);
}

function ensureDockerNetwork(networkName: string): void {
	const result = spawnSync(
		"docker",
		["network", "inspect", networkName],
		{
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		},
	);

	if (result.error) {
		throw result.error;
	}
	if (result.status === 0) {
		return;
	}

	runDocker(
		["network", "create", networkName],
		`Unable to create Docker network ${networkName}.`,
	);
}

async function ensureRedisContainer(service: DevRedisServiceConfig): Promise<void> {
	const state = inspectDockerContainer(service.redisContainerName);

	if (state === "running") {
		await waitForRedisContainer(service);
		return;
	}

	if (state === "stopped") {
		runDocker(["start", service.redisContainerName], `Unable to start Docker container ${service.redisContainerName}.`);
		await waitForRedisContainer(service);
		return;
	}

	runDocker(
		[
			"run",
			"--name",
			service.redisContainerName,
			"--network",
			service.networkName,
			"-p",
			`${service.redisPort}:6379`,
			"-v",
			`${service.redisVolumeName}:/data`,
			"-d",
			service.redisImage,
		],
		`Unable to create Docker container ${service.redisContainerName}.`,
	);
	await waitForRedisContainer(service);
}

async function ensureRedisHttpContainer(config: DevRedisConfig): Promise<void> {
	const state = inspectDockerContainer(config.httpContainerName);

	if (state === "running") {
		return;
	}

	if (state === "stopped") {
		runDocker(["start", config.httpContainerName], `Unable to start Docker container ${config.httpContainerName}.`);
		return;
	}

	runDocker(
		[
			"run",
			"--name",
			config.httpContainerName,
			"--network",
			config.networkName,
			"-p",
			`${config.restPort}:80`,
			"-e",
			"SRH_MODE=env",
			"-e",
			`SRH_TOKEN=${config.token}`,
			"-e",
			`SRH_CONNECTION_STRING=redis://${config.redisContainerName}:6379`,
			"-d",
			config.httpImage,
		],
		`Unable to create Docker container ${config.httpContainerName}.`,
	);
}

async function waitForRedisContainer(service: DevRedisServiceConfig): Promise<void> {
	let lastError = "";

	for (let attempt = 0; attempt < 40; attempt++) {
		const result = spawnSync(
			"docker",
			["exec", service.redisContainerName, "redis-cli", "ping"],
			{
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			},
		);

		if (result.status === 0 && result.stdout.trim() === "PONG") {
			return;
		}
		lastError = result.stderr || result.stdout;
		await new Promise((resolve) => setTimeout(resolve, 500));
	}

	throw new Error(`Timed out waiting for ${service.redisContainerName} to accept Redis connections. ${lastError.trim()}`);
}

async function waitForRedisRest(config: Pick<DevRedisConfig, "restUrl" | "token" | "httpContainerName">): Promise<void> {
	let lastError = "";

	for (let attempt = 0; attempt < 40; attempt++) {
		try {
			await pingRedisRest(config);
			return;
		} catch (error) {
			lastError = error instanceof Error ? error.message : String(error);
			await new Promise((resolve) => setTimeout(resolve, 500));
		}
	}

	throw new Error(`Timed out waiting for ${config.httpContainerName} to accept Redis REST requests. ${lastError}`);
}

async function pingRedisRest(config: Pick<DevRedisConfig, "restUrl" | "token">): Promise<string> {
	const response = await fetch(config.restUrl, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${config.token}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(["PING"]),
	});
	const body = await response.json() as { result?: unknown; error?: string };

	if (!response.ok || body.error) {
		throw new Error(body.error ?? `HTTP ${response.status}`);
	}
	if (body.result !== "PONG") {
		throw new Error(`Unexpected Redis PING response: ${JSON.stringify(body.result)}`);
	}
	return body.result;
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
  lightfast-dev-services setup [--json]
  lightfast-dev-services doctor [--postgres-table <name>] [--json]
  lightfast-dev-services identity --app-name <name> [--json]
  lightfast-dev-services inngest-sync [--mfe-app <name>] [--app-url <name=url>] -- <command> [...args]
  lightfast-dev-services postgres-url [--json]
  lightfast-dev-services postgres-up [--json]
  lightfast-dev-services postgres-create [--json]
  lightfast-dev-services redis-url [--json]
  lightfast-dev-services redis-up [--json]
  lightfast-dev-services redis-ping [--json]

Options:
  --app-name <name>     Runtime base app name for identity
  --config <path>       Path to related-projects.json. Default: walk upward from cwd
  --postgres-table <name>
                        Doctor check for an expected Postgres table
  --mfe-app <name>      Resolve a Portless MFE app URL through @lightfastai/related-projects
  --app-url <name=url>  Explicit app URL to sync into the Inngest Dev Server
  --serve-path <path>   Inngest serve route path. Default: /api/inngest
  --no-inngest-sync     Run the wrapped command without Inngest endpoint sync
  --json                Print JSON output where supported
`);
}
