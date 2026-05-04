import {
	resolveDevProjectIdentity,
	type DevProjectIdentity,
} from "@lightfastai/dev-core";
import {
	resolveDevPostgresConfig,
	type DevPostgresConfig,
} from "../postgres/config.js";
import {
	resolveDevRedisConfig,
	type DevRedisConfig,
} from "../redis/config.js";
import type { CliOptions } from "./types.js";

export interface ResolvedDevServiceConfigs {
	identity: DevProjectIdentity;
	postgres: DevPostgresConfig;
	redis: DevRedisConfig;
}

export function resolveProjectIdentityFromOptions(options: CliOptions): DevProjectIdentity {
	return resolveDevProjectIdentity({
		cwd: process.cwd(),
		configPath: options.configPath,
		env: process.env,
	});
}

export function resolveDevServiceConfigsFromOptions(options: CliOptions): ResolvedDevServiceConfigs {
	const identity = resolveProjectIdentityFromOptions(options);

	return {
		identity,
		postgres: resolveDevPostgresConfig({
			env: process.env,
			identity,
		}),
		redis: resolveDevRedisConfig({
			env: process.env,
			identity,
		}),
	};
}

export function resolvePostgresConfigFromOptions(options: CliOptions): DevPostgresConfig {
	return resolveDevPostgresConfig({
		cwd: process.cwd(),
		configPath: options.configPath,
		env: process.env,
	});
}

export function resolveRedisConfigFromOptions(options: CliOptions): DevRedisConfig {
	return resolveDevRedisConfig({
		cwd: process.cwd(),
		configPath: options.configPath,
		env: process.env,
	});
}
