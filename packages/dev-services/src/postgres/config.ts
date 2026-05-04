import {
	resolveDevProjectIdentity,
	type DevProjectIdentity,
	type DetectWorktreePrefix,
} from "@lightfastai/dev-core";
import type { Env } from "../types.js";

export interface ResolveDevPostgresDatabaseNameOptions {
	cwd?: string;
	configPath?: string;
	env?: Env;
	detectWorktreePrefix?: DetectWorktreePrefix;
	identity?: DevProjectIdentity;
}

export type ResolveDevPostgresConfigOptions = ResolveDevPostgresDatabaseNameOptions;

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

export const DEFAULT_DEV_POSTGRES_CONTAINER = "lightfast-postgres";
export const DEFAULT_DEV_POSTGRES_VOLUME = "lightfast-postgres-data";
export const DEFAULT_DEV_POSTGRES_IMAGE = "postgres:17-alpine";
export const DEFAULT_DEV_POSTGRES_HOST = "127.0.0.1";
export const DEFAULT_DEV_POSTGRES_PORT = 5432;
export const DEFAULT_DEV_POSTGRES_USERNAME = "postgres";
export const DEFAULT_DEV_POSTGRES_PASSWORD = "postgres";

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
	identity,
}: ResolveDevPostgresDatabaseNameOptions = {}): string {
	const explicitName = env.LIGHTFAST_DEV_DATABASE_NAME;
	if (explicitName) {
		return assertSafeDatabaseName(sanitizeDatabaseName(explicitName));
	}

	const projectIdentity = identity ?? resolveDevProjectIdentity({
		cwd,
		configPath,
		env,
		detectWorktreePrefix,
	});
	const basePart = sanitizeDatabaseName(projectIdentity.name);
	const worktreePart = sanitizeDatabaseName(projectIdentity.worktreePrefix ?? "main");
	const hash = projectIdentity.rootHash;
	const prefixMaxLength = POSTGRES_NAME_MAX_LENGTH - hash.length - 2;
	const prefix = truncateDatabasePrefix(`${basePart}_${worktreePart}`, prefixMaxLength);

	return assertSafeDatabaseName(`${prefix}_${hash}`);
}

export function resolveDevPostgresConfig({
	cwd = process.cwd(),
	configPath,
	env = process.env,
	detectWorktreePrefix,
	identity,
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
		identity,
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
