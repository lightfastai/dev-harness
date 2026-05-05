import type { Env } from "../types.js";
import type { DevPostgresConfig } from "../postgres/config.js";

export interface DevNeonHttpProxyConfig {
	containerName: string;
	image: string;
	networkName: string;
	host: string;
	hostPort: number;
	backendConnectionString: string;
}

export const DEFAULT_DEV_NEON_HTTP_PROXY_CONTAINER = "lightfast-neon-http-proxy";
export const DEFAULT_DEV_NEON_HTTP_PROXY_IMAGE = "ghcr.io/timowilhelm/local-neon-http-proxy:main";
export const DEFAULT_DEV_NEON_HTTP_PROXY_NETWORK = "lightfast-dev";
export const DEFAULT_DEV_NEON_HTTP_PROXY_HOST = "127.0.0.1";
export const DEFAULT_DEV_NEON_HTTP_PROXY_PORT = 4444;

export function resolveDevNeonHttpProxyConfig(
	postgres: DevPostgresConfig,
	env: Env = process.env,
): DevNeonHttpProxyConfig {
	return {
		containerName:
			env.LIGHTFAST_DEV_NEON_HTTP_PROXY_CONTAINER ||
			DEFAULT_DEV_NEON_HTTP_PROXY_CONTAINER,
		image:
			env.LIGHTFAST_DEV_NEON_HTTP_PROXY_IMAGE ||
			DEFAULT_DEV_NEON_HTTP_PROXY_IMAGE,
		networkName:
			env.LIGHTFAST_DEV_NEON_HTTP_PROXY_NETWORK ||
			DEFAULT_DEV_NEON_HTTP_PROXY_NETWORK,
		host:
			env.LIGHTFAST_DEV_NEON_HTTP_PROXY_HOST ||
			DEFAULT_DEV_NEON_HTTP_PROXY_HOST,
		hostPort: parsePort(env.LIGHTFAST_DEV_NEON_HTTP_PROXY_PORT) ?? DEFAULT_DEV_NEON_HTTP_PROXY_PORT,
		backendConnectionString:
			`postgresql://${postgres.username}:${postgres.password}` +
			`@${postgres.containerName}:5432/${postgres.databaseName}`,
	};
}

function parsePort(value?: string): number | undefined {
	if (!value) {
		return undefined;
	}

	const port = Number(value);
	return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : undefined;
}
