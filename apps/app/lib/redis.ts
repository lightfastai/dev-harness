import { existsSync } from "node:fs";
import path from "node:path";
import {
	type DevRedisConfig,
	resolveDevRedisConfig,
} from "@lightfastai/dev-services";
import { Redis } from "@upstash/redis";

function createAppRedis() {
	const config = resolveDevRedisConfig({
		baseName: "mfe_sandbox",
		cwd: resolveAppRedisCwd(),
	});
	const redis = new Redis({
		url: config.restUrl,
		token: config.token,
		enableAutoPipelining: true,
	});

	return {
		config,
		redis,
		key(rawKey: string) {
			if (config.source !== "derived") {
				return rawKey;
			}

			const prefix = `${config.keyPrefix}:`;
			return rawKey.startsWith(prefix)
				? rawKey
				: `${prefix}${rawKey.replace(/^:+/, "")}`;
		},
	};
}

type AppRedis = ReturnType<typeof createAppRedis>;

declare global {
	var __mfeSandboxAppRedis: AppRedis | undefined;
}

export function resolveAppRedisCwd(startDir = process.cwd()): string {
	let dir = path.resolve(startDir);

	for (;;) {
		if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
			return dir;
		}

		const parent = path.dirname(dir);
		if (parent === dir) {
			throw new Error(`Unable to find workspace root from ${startDir}`);
		}
		dir = parent;
	}
}

export function getAppRedis(): AppRedis {
	globalThis.__mfeSandboxAppRedis ??= createAppRedis();
	return globalThis.__mfeSandboxAppRedis;
}

export type AppRedisConfig = DevRedisConfig;
