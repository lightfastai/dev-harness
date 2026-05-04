import { existsSync } from "node:fs";
import path from "node:path";
import {
	type DevRedisConfig,
	redactRedisRestUrl,
	resolveDevRedisConfig,
} from "@lightfastai/dev-services";
import { Redis } from "@upstash/redis";

function createRedis() {
	const config = resolveDevRedisConfig({
		baseName: "mfe_sandbox",
		cwd: resolveExampleWorkspaceRoot(),
	});
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

declare global {
	var __mfeSandboxExampleRedis: ExampleRedis | undefined;
}

export function resolveExampleWorkspaceRoot(startDir = process.cwd()): string {
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

export function getRedis(): ExampleRedis {
	globalThis.__mfeSandboxExampleRedis ??= createRedis();
	return globalThis.__mfeSandboxExampleRedis;
}

export { Redis, redactRedisRestUrl };
export type ExampleRedisConfig = DevRedisConfig;
