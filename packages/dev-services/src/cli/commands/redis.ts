import {
	redactRedisRestUrl,
} from "../../redis/config.js";
import { ensureRedisServices } from "../../redis/docker.js";
import { pingRedisRest } from "../../redis/rest.js";
import { parseOptions } from "../args.js";
import { resolveRedisConfigFromOptions } from "../resolve.js";

export function handleRedisUrl(args: string[]): void {
	const { options } = parseOptions(args);
	const config = resolveRedisConfigFromOptions(options);

	if (options.json) {
		console.log(JSON.stringify({
			restUrl: config.restUrl,
			redactedRestUrl: redactRedisRestUrl(config.restUrl),
			redisUrl: config.redisUrl,
			keyPrefix: config.keyPrefix,
			source: config.source,
			host: config.host,
			redisPort: config.redisPort,
			restPort: config.restPort,
			redisContainerName: config.redisContainerName,
			httpContainerName: config.httpContainerName,
		}));
		return;
	}

	console.log(config.restUrl);
}

export async function handleRedisUp(args: string[]): Promise<void> {
	const { options } = parseOptions(args);
	const config = resolveRedisConfigFromOptions(options);
	await ensureRedisServices(config);

	if (options.json) {
		console.log(JSON.stringify({
			restUrl: config.restUrl,
			redactedRestUrl: redactRedisRestUrl(config.restUrl),
			redisUrl: config.redisUrl,
			keyPrefix: config.keyPrefix,
			source: config.source,
			networkName: config.networkName,
			redisContainerName: config.redisContainerName,
			httpContainerName: config.httpContainerName,
		}));
		return;
	}

	console.log(`Redis REST is running at ${config.restUrl} (${config.httpContainerName})`);
}

export async function handleRedisPing(args: string[]): Promise<void> {
	const { options } = parseOptions(args);
	const config = resolveRedisConfigFromOptions(options);
	await ensureRedisServices(config);
	const pong = await pingRedisRest(config);

	if (options.json) {
		console.log(JSON.stringify({
			restUrl: config.restUrl,
			redactedRestUrl: redactRedisRestUrl(config.restUrl),
			keyPrefix: config.keyPrefix,
			pong,
		}));
		return;
	}

	console.log(pong);
}
