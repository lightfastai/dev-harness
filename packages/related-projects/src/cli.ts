#!/usr/bin/env node

import { spawn } from "node:child_process";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import type { IncomingHttpHeaders, IncomingMessage, Server, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import {
	addTurboDevEnvMode,
	createVercelMicrofrontendsDevEnv,
	createVercelMicrofrontendsDevConfig,
	inferLocalAppNames,
	loadPortlessMfeConfig,
	resolvePortlessApplicationUrl,
	resolvePortlessMfeRuntime,
	resolvePortlessMfeUrl,
	startPortlessProxy,
} from "./index.js";
import type { Env, VercelMicrofrontendsDevConfigResult } from "./index.js";

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

interface PortlessAppBridge {
	appName: string;
	port: number;
	targetUrl: string;
	server: Server;
	closed: boolean;
}

interface MicrofrontendsProxyRuntime {
	proxy: ChildProcess;
	bridges: PortlessAppBridge[];
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
			...Object.entries(result.appBridgePorts ?? {}).map(([appName, port]) => `${appName} bridge: http://127.0.0.1:${port}`),
		].join("\n"),
	);

	const childEnv = createVercelMicrofrontendsDevEnv({
		result,
		localApps,
		env: process.env,
	});
	const shouldStartProxy = !isTurboRunCommand(commandArgs);
	const proxyRuntime = shouldStartProxy
		? await startMicrofrontendsProxyRuntime({ config, result, localApps, env: childEnv })
		: undefined;
	const devCommandArgs = disableTurboFrameworkInference(addTurboDevEnvMode(commandArgs));
	const child = spawn(devCommandArgs[0], devCommandArgs.slice(1), {
		cwd: config.root,
		env: childEnv,
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
		proxyRuntime.proxy.on("exit", (code, signal) => {
			if (shuttingDown) {
				return;
			}

			shuttingDown = true;
			closePortlessAppBridges(proxyRuntime.bridges);
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

	proxyRuntime.proxy.on("exit", (code, signal) => {
		closePortlessAppBridges(proxyRuntime.bridges);
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
}: {
	config: { root: string };
	result: VercelMicrofrontendsDevConfigResult;
	localApps: string[];
	env: Env;
}): Promise<MicrofrontendsProxyRuntime> {
	const bridges = await startPortlessAppBridges({ result, localApps });
	try {
		const proxy = await startMicrofrontendsProxy({ config, result, localApps, env });
		return { proxy, bridges };
	} catch (error) {
		closePortlessAppBridges(bridges);
		throw error;
	}
}

async function startPortlessAppBridges({
	result,
	localApps,
}: {
	result: VercelMicrofrontendsDevConfigResult;
	localApps: string[];
}): Promise<PortlessAppBridge[]> {
	const bridges: PortlessAppBridge[] = [];

	for (const appName of localApps) {
		const targetUrl = result.appUrls?.[appName];
		const port = result.appBridgePorts?.[appName];
		if (!targetUrl || !port) {
			continue;
		}

		const server = http.createServer((req, res) => {
			proxyToPortlessApp({ appName, targetUrl, req, res });
		});
		server.on("clientError", (_error, socket) => {
			if (socket.writable) {
				socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
			}
		});
		server.on("upgrade", (req, socket, head) => {
			proxyUpgradeToPortlessApp({ targetUrl, req, socket, head });
		});
		await listen(server, port);
		bridges.push({ appName, port, targetUrl, server, closed: false });
	}

	return bridges;
}

function listen(server: Server, port: number): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		const onError = (error: Error) => {
			server.off("listening", onListening);
			reject(error);
		};
		const onListening = () => {
			server.off("error", onError);
			resolve();
		};
		server.once("error", onError);
		server.once("listening", onListening);
		server.listen(port, "127.0.0.1");
	});
}

function proxyToPortlessApp({
	appName,
	targetUrl,
	req,
	res,
}: {
	appName: string;
	targetUrl: string;
	req: IncomingMessage;
	res: ServerResponse;
}): void {
	const target = new URL(req.url ?? "/", targetUrl);
	const headers = buildBridgeRequestHeaders(req.headers, target);
	const requestModule = target.protocol === "https:" ? https : http;
	const proxyReq = requestModule.request(
		{
			protocol: target.protocol,
			hostname: target.hostname,
			port: target.port || (target.protocol === "https:" ? 443 : 80),
			path: `${target.pathname}${target.search}`,
			method: req.method,
			headers,
		},
		(proxyRes) => {
			const responseHeaders = stripHopByHopHeaders(proxyRes.headers);
			proxyRes.on("error", () => {
				if (!res.destroyed) {
					res.destroy();
				}
			});
			safeWriteHead(res, proxyRes.statusCode ?? 502, responseHeaders);
			proxyRes.pipe(res);
		},
	);

	proxyReq.on("error", (error) => {
		if (!res.destroyed && !res.writableEnded) {
			if (!res.headersSent) {
				safeWriteHead(res, 502, { "Content-Type": "text/plain" });
			}
			safeEnd(res, `Error proxying ${appName} through Portless: ${error.message}`);
		}
	});
	req.on("error", () => {
		proxyReq.destroy();
	});
	res.on("error", () => {
		proxyReq.destroy();
	});
	res.on("close", () => {
		if (!proxyReq.destroyed) {
			proxyReq.destroy();
		}
	});
	req.pipe(proxyReq);
}

function proxyUpgradeToPortlessApp({
	targetUrl,
	req,
	socket,
	head,
}: {
	targetUrl: string;
	req: IncomingMessage;
	socket: Duplex;
	head: Buffer;
}): void {
	socket.on("error", () => {
		socket.destroy();
	});

	const target = new URL(req.url ?? "/", targetUrl);
	const headers = buildBridgeRequestHeaders(req.headers, target);
	const requestModule = target.protocol === "https:" ? https : http;
	const proxyReq = requestModule.request({
		protocol: target.protocol,
		hostname: target.hostname,
		port: target.port || (target.protocol === "https:" ? 443 : 80),
		path: `${target.pathname}${target.search}`,
		method: req.method,
		headers,
	});

	proxyReq.on("upgrade", (proxyRes, proxySocket, proxyHead) => {
		proxySocket.on("error", () => {
			socket.destroy();
		});
		let response = `HTTP/1.1 ${proxyRes.statusCode ?? 101} ${proxyRes.statusMessage ?? "Switching Protocols"}\r\n`;
		for (let i = 0; i < proxyRes.rawHeaders.length; i += 2) {
			response += `${proxyRes.rawHeaders[i]}: ${proxyRes.rawHeaders[i + 1]}\r\n`;
		}
		response += "\r\n";
		socket.write(response);
		if (proxyHead.length) {
			socket.write(proxyHead);
		}
		if (head.length) {
			proxySocket.write(head);
		}
		socket.pipe(proxySocket);
		proxySocket.pipe(socket);
	});
	proxyReq.on("response", (proxyRes) => {
		writeRawHttpResponse(socket, proxyRes, {
			...stripHopByHopHeaders(proxyRes.headers),
			connection: "close",
		});
		proxyRes.pipe(socket);
	});
	proxyReq.on("error", () => {
		socket.destroy();
	});
	proxyReq.end();
}

function buildBridgeRequestHeaders(
	sourceHeaders: IncomingHttpHeaders,
	target: URL,
): Record<string, string | string[]> {
	const headers = stripHopByHopHeaders(sourceHeaders);
	deleteHeader(headers, "x-portless");
	deleteHeader(headers, "x-portless-hops");
	headers.host = target.host;
	return headers;
}

function stripHopByHopHeaders(
	sourceHeaders: IncomingHttpHeaders,
): Record<string, string | string[]> {
	const blockedHeaders = new Set([
		"connection",
		"keep-alive",
		"proxy-connection",
		"te",
		"trailer",
		"transfer-encoding",
		"upgrade",
	]);
	const headers: Record<string, string | string[]> = {};
	for (const [key, value] of Object.entries(sourceHeaders)) {
		if (value !== undefined && !blockedHeaders.has(key.toLowerCase())) {
			headers[key] = value;
		}
	}
	return headers;
}

function deleteHeader(headers: Record<string, unknown>, headerName: string): void {
	const normalizedHeaderName = headerName.toLowerCase();
	for (const key of Object.keys(headers)) {
		if (key.toLowerCase() === normalizedHeaderName) {
			delete headers[key];
		}
	}
}

function writeRawHttpResponse(
	socket: Duplex,
	proxyRes: IncomingMessage,
	headers: Record<string, string | string[] | number | undefined>,
): void {
	let response = `HTTP/1.1 ${proxyRes.statusCode ?? 502} ${proxyRes.statusMessage ?? "Bad Gateway"}\r\n`;
	for (const [key, value] of Object.entries(headers)) {
		if (Array.isArray(value)) {
			for (const item of value) {
				response += `${key}: ${item}\r\n`;
			}
		} else {
			response += `${key}: ${value}\r\n`;
		}
	}
	response += "\r\n";
	socket.write(response);
}

function safeWriteHead(
	res: ServerResponse,
	statusCode: number,
	headers: Record<string, string | string[] | number | undefined>,
): void {
	if (res.destroyed || res.headersSent) {
		return;
	}
	try {
		res.writeHead(statusCode, headers);
	} catch {
		res.destroy();
	}
}

function safeEnd(res: ServerResponse, body: string): void {
	if (res.destroyed || res.writableEnded) {
		return;
	}
	try {
		res.end(body);
	} catch {
		res.destroy();
	}
}

function stopMicrofrontendsProxyRuntime(
	runtime: MicrofrontendsProxyRuntime | undefined,
	signal: NodeJS.Signals,
): void {
	if (!runtime) {
		return;
	}
	if (!runtime.proxy.killed) {
		runtime.proxy.kill(signal);
	}
	closePortlessAppBridges(runtime.bridges);
}

function closePortlessAppBridges(bridges: PortlessAppBridge[] = []): void {
	for (const bridge of bridges) {
		if (bridge.closed) {
			continue;
		}
		bridge.closed = true;
		bridge.server.close();
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
  portless-mfe proxy [--local-app <name>]
  portless-mfe url [--app <name>] [--path <path>] [--json]
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
