import { createHash } from "node:crypto";
import path from "node:path";
import {
	resolveDevProjectConfig,
	resolveWorktreeIdentity,
	type DetectWorktreePrefix,
} from "@lightfastai/dev-core";

export type Env = Record<string, string | undefined>;

export interface ResolveDevPostgresDatabaseNameOptions {
	cwd?: string;
	configPath?: string;
	env?: Env;
	detectWorktreePrefix?: DetectWorktreePrefix;
}

export type ResolveDevPostgresConfigOptions = ResolveDevPostgresDatabaseNameOptions;

export interface ResolveDevRedisKeyPrefixOptions {
	cwd?: string;
	configPath?: string;
	env?: Env;
	detectWorktreePrefix?: DetectWorktreePrefix;
}

export type ResolveDevRedisConfigOptions = ResolveDevRedisKeyPrefixOptions;

export interface DevPostgresServiceConfig {
	containerName: string;
	volumeName: string;
	image: string;
	host: string;
	port: number;
	username: string;
	password: string;
}

export interface DevPostgresConfig extends DevPostgresServiceConfig {
	databaseName: string;
	databaseUrl: string;
	source: "derived" | "env";
}

export interface LocalDevPostgresUrl {
	url: URL;
	databaseName: string;
}

export interface DevRedisServiceConfig {
	networkName: string;
	redisContainerName: string;
	redisVolumeName: string;
	redisImage: string;
	httpContainerName: string;
	httpImage: string;
	host: string;
	redisPort: number;
	restPort: number;
	restToken: string;
}

export interface DevRedisConfig extends DevRedisServiceConfig {
	redisUrl: string;
	restUrl: string;
	token: string;
	keyPrefix: string;
	source: "derived" | "env";
}

export const DEFAULT_DEV_POSTGRES_CONTAINER = "lightfast-postgres";
export const DEFAULT_DEV_POSTGRES_VOLUME = "lightfast-postgres-data";
export const DEFAULT_DEV_POSTGRES_IMAGE = "postgres:17-alpine";
export const DEFAULT_DEV_POSTGRES_HOST = "127.0.0.1";
export const DEFAULT_DEV_POSTGRES_PORT = 5432;
export const DEFAULT_DEV_POSTGRES_USERNAME = "postgres";
export const DEFAULT_DEV_POSTGRES_PASSWORD = "postgres";
export const DEFAULT_DEV_REDIS_NETWORK = "lightfast-dev-services";
export const DEFAULT_DEV_REDIS_CONTAINER = "lightfast-redis";
export const DEFAULT_DEV_REDIS_VOLUME = "lightfast-redis-data";
export const DEFAULT_DEV_REDIS_IMAGE = "redis/redis-stack-server:6.2.6-v6";
export const DEFAULT_DEV_REDIS_HTTP_CONTAINER = "lightfast-redis-http";
export const DEFAULT_DEV_REDIS_HTTP_IMAGE = "hiett/serverless-redis-http:latest";
export const DEFAULT_DEV_REDIS_HOST = "127.0.0.1";
export const DEFAULT_DEV_REDIS_PORT = 6379;
export const DEFAULT_DEV_REDIS_REST_PORT = 8079;
export const DEFAULT_DEV_REDIS_REST_TOKEN = "lightfast-dev-redis-token";

const POSTGRES_NAME_MAX_LENGTH = 63;
const RESERVED_DATABASE_NAMES = new Set(["postgres", "template0", "template1"]);

export function resolveDevPostgresServiceConfig(
	env: Env = process.env,
): DevPostgresServiceConfig {
	const databaseUrl = env.DATABASE_URL
		? assertLocalDevPostgresUrl(env.DATABASE_URL).url
		: undefined;

	return {
		containerName: env.LIGHTFAST_DEV_POSTGRES_CONTAINER || DEFAULT_DEV_POSTGRES_CONTAINER,
		volumeName: env.LIGHTFAST_DEV_POSTGRES_VOLUME || DEFAULT_DEV_POSTGRES_VOLUME,
		image: env.LIGHTFAST_DEV_POSTGRES_IMAGE || DEFAULT_DEV_POSTGRES_IMAGE,
		host: databaseUrl
			? normalizeLocalHostname(databaseUrl.hostname)
			: DEFAULT_DEV_POSTGRES_HOST,
		port: parsePort(env.LIGHTFAST_DEV_POSTGRES_PORT) ??
			parsePort(databaseUrl?.port) ??
			DEFAULT_DEV_POSTGRES_PORT,
		username: databaseUrl?.username
			? decodeURIComponent(databaseUrl.username)
			: DEFAULT_DEV_POSTGRES_USERNAME,
		password: databaseUrl?.password
			? decodeURIComponent(databaseUrl.password)
			: DEFAULT_DEV_POSTGRES_PASSWORD,
	};
}

export function resolveDevPostgresDatabaseName({
	cwd = process.cwd(),
	configPath,
	env = process.env,
	detectWorktreePrefix,
}: ResolveDevPostgresDatabaseNameOptions = {}): string {
	const explicitName = env.LIGHTFAST_DEV_DATABASE_NAME;
	if (explicitName) {
		return assertSafeDatabaseName(sanitizeDatabaseName(explicitName));
	}

	const project = resolveDevProjectConfig({ cwd, configPath });
	const identity = resolveWorktreeIdentity({
		baseName: project.name,
		cwd: project.root,
		detectWorktreePrefix,
	});
	const basePart = sanitizeDatabaseName(identity.baseName);
	const worktreePart = sanitizeDatabaseName(identity.worktreePrefix ?? "main");
	const hash = createHash("sha1")
		.update(path.resolve(project.root))
		.digest("hex")
		.slice(0, 8);
	const prefixMaxLength = POSTGRES_NAME_MAX_LENGTH - hash.length - 2;
	const prefix = truncateDatabasePrefix(`${basePart}_${worktreePart}`, prefixMaxLength);

	return assertSafeDatabaseName(`${prefix}_${hash}`);
}

export function resolveDevPostgresConfig({
	cwd = process.cwd(),
	configPath,
	env = process.env,
	detectWorktreePrefix,
}: ResolveDevPostgresConfigOptions = {}): DevPostgresConfig {
	const service = resolveDevPostgresServiceConfig(env);
	const databaseUrl = env.DATABASE_URL;

	if (databaseUrl) {
		const parsed = assertLocalDevPostgresUrl(databaseUrl);
		return {
			...service,
			host: normalizeLocalHostname(parsed.url.hostname),
			port: parsePort(parsed.url.port) ?? DEFAULT_DEV_POSTGRES_PORT,
			username: decodeURIComponent(parsed.url.username || service.username),
			password: decodeURIComponent(parsed.url.password || service.password),
			databaseName: parsed.databaseName,
			databaseUrl: parsed.url.toString(),
			source: "env",
		};
	}

	const databaseName = resolveDevPostgresDatabaseName({
		cwd,
		configPath,
		env,
		detectWorktreePrefix,
	});
	const url = new URL("postgresql://127.0.0.1");
	url.hostname = service.host;
	url.port = String(service.port);
	url.username = service.username;
	url.password = service.password;
	url.pathname = `/${databaseName}`;

	return {
		...service,
		databaseName,
		databaseUrl: url.toString(),
		source: "derived",
	};
}

export function assertLocalDevPostgresUrl(value: string): LocalDevPostgresUrl {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error("DATABASE_URL must be a valid PostgreSQL URL.");
	}

	if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
		throw new Error("DATABASE_URL must use the postgres:// or postgresql:// protocol.");
	}

	const hostname = url.hostname.toLowerCase();
	if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname)) {
		throw new Error("DATABASE_URL must point at localhost for dev Postgres helpers.");
	}

	const databaseName = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
	if (!databaseName) {
		throw new Error("DATABASE_URL must include a database name.");
	}
	if (databaseName !== sanitizeDatabaseName(databaseName)) {
		throw new Error("DATABASE_URL database name must contain only lowercase letters, numbers, and underscores.");
	}

	return {
		url,
		databaseName: assertSafeDatabaseName(databaseName),
	};
}

export function redactPostgresUrl(value: string): string {
	try {
		const url = new URL(value);
		if (url.password) {
			url.password = "****";
		}
		return url.toString();
	} catch {
		return "<invalid-postgres-url>";
	}
}

export function resolveDevRedisServiceConfig(env: Env = process.env): DevRedisServiceConfig {
	return {
		networkName: env.LIGHTFAST_DEV_REDIS_NETWORK || DEFAULT_DEV_REDIS_NETWORK,
		redisContainerName: env.LIGHTFAST_DEV_REDIS_CONTAINER || DEFAULT_DEV_REDIS_CONTAINER,
		redisVolumeName: env.LIGHTFAST_DEV_REDIS_VOLUME || DEFAULT_DEV_REDIS_VOLUME,
		redisImage: env.LIGHTFAST_DEV_REDIS_IMAGE || DEFAULT_DEV_REDIS_IMAGE,
		httpContainerName: env.LIGHTFAST_DEV_REDIS_HTTP_CONTAINER || DEFAULT_DEV_REDIS_HTTP_CONTAINER,
		httpImage: env.LIGHTFAST_DEV_REDIS_HTTP_IMAGE || DEFAULT_DEV_REDIS_HTTP_IMAGE,
		host: env.LIGHTFAST_DEV_REDIS_HOST || DEFAULT_DEV_REDIS_HOST,
		redisPort: parsePort(env.LIGHTFAST_DEV_REDIS_PORT) ?? DEFAULT_DEV_REDIS_PORT,
		restPort: parsePort(env.LIGHTFAST_DEV_REDIS_REST_PORT) ?? DEFAULT_DEV_REDIS_REST_PORT,
		restToken: env.LIGHTFAST_DEV_REDIS_REST_TOKEN || DEFAULT_DEV_REDIS_REST_TOKEN,
	};
}

export function resolveDevRedisKeyPrefix({
	cwd = process.cwd(),
	configPath,
	env = process.env,
	detectWorktreePrefix,
}: ResolveDevRedisKeyPrefixOptions = {}): string {
	const explicitPrefix = env.LIGHTFAST_DEV_REDIS_KEY_PREFIX;
	if (explicitPrefix) {
		return assertSafeRedisKeyPrefix(sanitizeRedisKeyPrefix(explicitPrefix));
	}

	const project = resolveDevProjectConfig({ cwd, configPath });
	const identity = resolveWorktreeIdentity({
		baseName: project.name,
		cwd: project.root,
		detectWorktreePrefix,
	});
	const basePart = sanitizeRedisKeyPrefixPart(identity.baseName);
	const worktreePart = sanitizeRedisKeyPrefixPart(identity.worktreePrefix ?? "main");
	const hash = createHash("sha1")
		.update(path.resolve(project.root))
		.digest("hex")
		.slice(0, 8);

	return assertSafeRedisKeyPrefix(`${basePart}:${worktreePart}:${hash}`);
}

export function resolveDevRedisConfig({
	cwd = process.cwd(),
	configPath,
	env = process.env,
	detectWorktreePrefix,
}: ResolveDevRedisConfigOptions = {}): DevRedisConfig {
	const service = resolveDevRedisServiceConfig(env);
	const envRestUrl = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
	const envToken = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
	const keyPrefix = resolveDevRedisKeyPrefix({
		cwd,
		configPath,
		env,
		detectWorktreePrefix,
	});

	if (envRestUrl || envToken) {
		if (!(envRestUrl && envToken)) {
			throw new Error("Redis REST config requires both URL and token.");
		}

		return {
			...service,
			redisUrl: `redis://${service.host}:${service.redisPort}`,
			restUrl: normalizeUrl(envRestUrl),
			token: envToken,
			keyPrefix,
			source: "env",
		};
	}

	const restUrl = new URL("http://127.0.0.1");
	restUrl.hostname = service.host;
	restUrl.port = String(service.restPort);

	return {
		...service,
		redisUrl: `redis://${service.host}:${service.redisPort}`,
		restUrl: restUrl.toString().replace(/\/$/, ""),
		token: service.restToken,
		keyPrefix,
		source: "derived",
	};
}

export function redactRedisRestUrl(value: string): string {
	try {
		const url = new URL(value);
		if (url.username) {
			url.username = "****";
		}
		if (url.password) {
			url.password = "****";
		}
		if (url.searchParams.has("_token")) {
			url.searchParams.set("_token", "****");
		}
		return url.toString().replace(/\/$/, "");
	} catch {
		return "<invalid-redis-rest-url>";
	}
}

export interface InngestDevSyncTarget {
	appName: string;
	url: string;
}

export interface BuildInngestDevSyncTargetsOptions {
	result: {
		appUrls: Record<string, string>;
		localAppNames?: string[];
	};
	localApps?: string[];
	servePath?: string;
}

export interface InngestDevSyncLogger {
	log(message: string): void;
	warn(message: string): void;
}

export interface InngestDevSyncRuntime {
	targets: InngestDevSyncTarget[];
	stop(): void;
}

export interface InngestDevSyncResult {
	status: "synced" | "skipped" | "retry";
	statusCode?: number;
	reason?: string;
}

type InngestDevSyncFetch = (
	input: string | URL,
	init?: RequestInit,
) => Promise<Pick<Response, "status">>;

export interface SyncInngestDevTargetOptions {
	fetchImpl?: InngestDevSyncFetch;
	requestTimeoutMs?: number;
}

export interface StartInngestDevSyncOptions extends SyncInngestDevTargetOptions {
	targets: InngestDevSyncTarget[];
	enabled?: boolean;
	logger?: InngestDevSyncLogger;
	intervalMs?: number;
	initialDelayMs?: number;
	skipAfterMs?: number;
}

export const DEFAULT_INNGEST_SERVE_PATH = "/api/inngest";
export const DEFAULT_INNGEST_SYNC_INTERVAL_MS = 2_000;
export const DEFAULT_INNGEST_SYNC_REQUEST_TIMEOUT_MS = 2_000;
export const DEFAULT_INNGEST_SYNC_SKIP_GRACE_MS = 15_000;

function parsePort(value?: string): number | undefined {
	if (!value) {
		return undefined;
	}

	const port = Number(value);
	return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : undefined;
}

function normalizeLocalHostname(hostname: string): string {
	return hostname === "::1" || hostname === "[::1]" ? "127.0.0.1" : hostname;
}

function normalizeUrl(value: string): string {
	try {
		const url = new URL(value);
		return url.toString().replace(/\/$/, "");
	} catch {
		throw new Error("Redis REST URL must be a valid URL.");
	}
}

function sanitizeDatabaseName(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9_]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.replace(/_+/g, "_");
}

function truncateDatabasePrefix(value: string, maxLength: number): string {
	return value.slice(0, maxLength).replace(/_+$/g, "") || "dev";
}

function assertSafeDatabaseName(value: string): string {
	if (!value) {
		throw new Error("Dev Postgres database name cannot be empty.");
	}
	if (RESERVED_DATABASE_NAMES.has(value)) {
		throw new Error(`Refusing to use reserved Postgres database "${value}".`);
	}
	if (!/^[a-z0-9_]+$/.test(value)) {
		throw new Error("Dev Postgres database name must contain only lowercase letters, numbers, and underscores.");
	}
	if (value.length > POSTGRES_NAME_MAX_LENGTH) {
		throw new Error(`Dev Postgres database name must be ${POSTGRES_NAME_MAX_LENGTH} characters or fewer.`);
	}
	return value;
}

function sanitizeRedisKeyPrefix(value: string): string {
	return value
		.split(":")
		.map(sanitizeRedisKeyPrefixPart)
		.filter(Boolean)
		.join(":");
}

function sanitizeRedisKeyPrefixPart(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.replace(/-+/g, "-");
}

function assertSafeRedisKeyPrefix(value: string): string {
	if (!value) {
		throw new Error("Dev Redis key prefix cannot be empty.");
	}
	if (!/^[a-z0-9-]+(:[a-z0-9-]+)*$/.test(value)) {
		throw new Error("Dev Redis key prefix must contain lowercase letters, numbers, hyphens, and colon separators.");
	}
	return value;
}

export function isInngestDevSyncEnabled(env: Env = process.env): boolean {
	const value = env.PORTLESS_MFE_INNGEST_SYNC?.toLowerCase();
	return value !== "0" && value !== "false" && value !== "off";
}

export function buildInngestDevSyncTargets({
	result,
	localApps = result.localAppNames ?? Object.keys(result.appUrls),
	servePath = DEFAULT_INNGEST_SERVE_PATH,
}: BuildInngestDevSyncTargetsOptions): InngestDevSyncTarget[] {
	return localApps.flatMap((appName) => {
		const appUrl = result.appUrls[appName];
		if (!appUrl) {
			return [];
		}

		return [{
			appName,
			url: new URL(servePath, appUrl).toString(),
		}];
	});
}

export async function syncInngestDevTarget(
	target: InngestDevSyncTarget,
	{
		fetchImpl = globalThis.fetch,
		requestTimeoutMs = DEFAULT_INNGEST_SYNC_REQUEST_TIMEOUT_MS,
	}: SyncInngestDevTargetOptions = {},
): Promise<InngestDevSyncResult> {
	if (!fetchImpl) {
		return {
			status: "retry",
			reason: "fetch is not available",
		};
	}

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

	try {
		const response = await fetchImpl(target.url, {
			method: "PUT",
			signal: controller.signal,
		});

		if (response.status >= 200 && response.status < 300) {
			return {
				status: "synced",
				statusCode: response.status,
			};
		}

		if (response.status === 404 || response.status === 405) {
			return {
				status: "skipped",
				statusCode: response.status,
				reason: `HTTP ${response.status}`,
			};
		}

		return {
			status: "retry",
			statusCode: response.status,
			reason: `HTTP ${response.status}`,
		};
	} catch (error) {
		return {
			status: "retry",
			reason: error instanceof Error ? error.message : String(error),
		};
	} finally {
		clearTimeout(timeout);
	}
}

export function startInngestDevSync({
	targets,
	enabled = true,
	logger = console,
	intervalMs = DEFAULT_INNGEST_SYNC_INTERVAL_MS,
	initialDelayMs = 1_000,
	skipAfterMs = DEFAULT_INNGEST_SYNC_SKIP_GRACE_MS,
	fetchImpl = globalThis.fetch,
	requestTimeoutMs = DEFAULT_INNGEST_SYNC_REQUEST_TIMEOUT_MS,
}: StartInngestDevSyncOptions): InngestDevSyncRuntime {
	const timers = new Set<NodeJS.Timeout>();
	const targetStartedAt = new Map<string, number>();
	let stopped = false;

	const runtime: InngestDevSyncRuntime = {
		targets,
		stop() {
			stopped = true;
			for (const timer of timers) {
				clearTimeout(timer);
			}
			timers.clear();
		},
	};

	if (!enabled || targets.length === 0) {
		return runtime;
	}

	const schedule = (target: InngestDevSyncTarget, delayMs: number) => {
		if (stopped) {
			return;
		}

		const timer = setTimeout(() => {
			timers.delete(timer);
			void attempt(target);
		}, delayMs);
		timers.add(timer);
	};

	const attempt = async (target: InngestDevSyncTarget) => {
		if (stopped) {
			return;
		}
		const targetKey = `${target.appName}:${target.url}`;
		const startedAt = targetStartedAt.get(targetKey) ?? Date.now();
		targetStartedAt.set(targetKey, startedAt);

		const result = await syncInngestDevTarget(target, {
			fetchImpl,
			requestTimeoutMs,
		});

		if (stopped) {
			return;
		}

		if (result.status === "synced") {
			logger.log(`Inngest synced ${target.appName}: ${target.url}`);
			return;
		}

		if (result.status === "skipped") {
			if (Date.now() - startedAt < skipAfterMs) {
				schedule(target, intervalMs);
				return;
			}
			logger.log(`Inngest sync skipped ${target.appName}: ${result.reason ?? "not available"}`);
			return;
		}

		schedule(target, intervalMs);
	};

	for (const target of targets) {
		schedule(target, initialDelayMs);
	}

	return runtime;
}
