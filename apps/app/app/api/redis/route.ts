import { redactRedisRestUrl } from "@lightfastai/dev-services";

import { getAppRedis } from "../../../lib/redis";

export const runtime = "nodejs";

export async function GET() {
	const { config, key, redis } = getAppRedis();
	const rawProbeKey = `probe:${Date.now()}`;
	const probeKey = key(rawProbeKey);
	const ping = await redis.ping();

	await redis.setex(probeKey, 30, "ok");
	const value = await redis.get(probeKey);
	await redis.del(probeKey);

	return Response.json({
		app: "app",
		driver: "@upstash/redis",
		source: config.source,
		restUrl: redactRedisRestUrl(config.restUrl),
		keyPrefix: config.source === "derived" ? config.keyPrefix : null,
		probeKey,
		ping,
		value,
	});
}
