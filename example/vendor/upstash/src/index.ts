import {
	type DevRedisConfig,
	redactRedisRestUrl,
	resolveDevRedisConfig,
} from "@lightfastai/dev-services";
import { Redis } from "@upstash/redis";

function createRedis() {
	const config = resolveDevRedisConfig();
	const redis = new Redis({
		url: config.restUrl,
		token: config.token,
		enableAutoPipelining: true,
	});

	return {
		config,
		key(rawKey: string) {
			if (config.source !== "derived") {
				return rawKey;
			}

			const prefix = `${config.keyPrefix}:`;
			return rawKey.startsWith(prefix)
				? rawKey
				: `${prefix}${rawKey.replace(/^:+/, "")}`;
		},
		redis,
	};
}

type ExampleRedis = ReturnType<typeof createRedis>;

let redisInstance: ExampleRedis | undefined;

export function getRedis(): ExampleRedis {
	// Upstash Redis uses HTTP and does not own a TCP pool like postgres.js, so a
	// module-local singleton is enough for lazy config/client creation.
	redisInstance ??= createRedis();
	return redisInstance;
}

export { Redis, redactRedisRestUrl };
export type ExampleRedisConfig = DevRedisConfig;
