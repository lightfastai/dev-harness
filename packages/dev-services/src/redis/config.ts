import {
	resolveDevProjectIdentity,
	type DevProjectIdentity,
	type DetectWorktreePrefix,
} from "@lightfastai/dev-core";
import type { Env } from "../types.js";

export interface ResolveDevRedisKeyPrefixOptions {
	cwd?: string;
	configPath?: string;
	env?: Env;
	detectWorktreePrefix?: DetectWorktreePrefix;
	identity?: DevProjectIdentity;
}

export type ResolveDevRedisConfigOptions = ResolveDevRedisKeyPrefixOptions;

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
	identity,
}: ResolveDevRedisKeyPrefixOptions = {}): string {
	const explicitPrefix = env.LIGHTFAST_DEV_REDIS_KEY_PREFIX;
	if (explicitPrefix) {
		return assertSafeRedisKeyPrefix(sanitizeRedisKeyPrefix(explicitPrefix));
	}

	const projectIdentity = identity ?? resolveDevProjectIdentity({
		cwd,
		configPath,
		env,
		detectWorktreePrefix,
	});
	const basePart = sanitizeRedisKeyPrefixPart(projectIdentity.name);
	const worktreePart = sanitizeRedisKeyPrefixPart(projectIdentity.worktreePrefix ?? "main");

	return assertSafeRedisKeyPrefix(`${basePart}:${worktreePart}:${projectIdentity.rootHash}`);
}

export function resolveDevRedisConfig({
	cwd = process.cwd(),
	configPath,
	env = process.env,
	detectWorktreePrefix,
	identity,
}: ResolveDevRedisConfigOptions = {}): DevRedisConfig {
	const service = resolveDevRedisServiceConfig(env);
	const envRestUrl = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
	const envToken = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
	const keyPrefix = resolveDevRedisKeyPrefix({
		cwd,
		configPath,
		env,
		detectWorktreePrefix,
		identity,
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

function parsePort(value?: string): number | undefined {
	if (!value) {
		return undefined;
	}

	const port = Number(value);
	return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : undefined;
}

function normalizeUrl(value: string): string {
	try {
		const url = new URL(value);
		return url.toString().replace(/\/$/, "");
	} catch {
		throw new Error("Redis REST URL must be a valid URL.");
	}
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
