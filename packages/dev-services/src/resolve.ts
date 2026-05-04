import {
	resolveDevProjectIdentity,
	type DevProjectIdentity,
} from "@lightfastai/dev-core";
import {
	resolveDevPostgresConfig,
	type DevPostgresConfig,
} from "./postgres/config.js";
import {
	resolveDevRedisConfig,
	type DevRedisConfig,
} from "./redis/config.js";
import type { DevServiceOptions } from "./options.js";

export interface ResolvedDevServiceConfigs {
	identity: DevProjectIdentity;
	postgres: DevPostgresConfig;
	redis: DevRedisConfig;
}

export function resolveProjectIdentity({
	cwd = process.cwd(),
	configPath,
	env = process.env,
}: DevServiceOptions = {}): DevProjectIdentity {
	return resolveDevProjectIdentity({
		cwd,
		configPath,
		env,
	});
}

export function resolveDevServiceConfigs(options: DevServiceOptions = {}): ResolvedDevServiceConfigs {
	const identity = resolveProjectIdentity(options);
	const env = options.env ?? process.env;

	return {
		identity,
		postgres: resolveDevPostgresConfig({
			env,
			identity,
		}),
		redis: resolveDevRedisConfig({
			env,
			identity,
		}),
	};
}
