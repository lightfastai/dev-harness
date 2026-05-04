import { inspectDockerContainer } from "../docker/client.js";
import {
	addCheck,
	addFailedCheck,
} from "../reports/format.js";
import type {
	DevServicesReport,
	RedisReport,
} from "../reports/types.js";
import type { DevRedisConfig } from "./config.js";
import { pingRedisRest } from "./rest.js";

export async function checkRedisDoctor(
	report: DevServicesReport,
	target: RedisReport,
	config: DevRedisConfig,
	dockerAvailable: boolean,
): Promise<void> {
	if (config.source === "env") {
		addCheck(target, {
			name: "redis-services",
			status: "skip",
			message: "Redis uses env-backed REST config.",
		});
		await checkRedisPing(report, target, config);
		return;
	}

	if (!dockerAvailable) {
		addFailedCheck(report, target, {
			name: "redis-services",
			message: "Skipped Redis checks because Docker is not available.",
			remediation: "Start Docker, then run pnpm dev:setup.",
		});
		addCheck(target, {
			name: "redis-ping",
			status: "skip",
			message: "Docker is not available.",
		});
		return;
	}

	const redisState = inspectDockerContainer(config.redisContainerName);
	const httpState = inspectDockerContainer(config.httpContainerName);
	if (redisState !== "running" || httpState !== "running") {
		addFailedCheck(report, target, {
			name: "redis-services",
			message: `${config.redisContainerName} is ${redisState}; ${config.httpContainerName} is ${httpState}.`,
			remediation: "Run pnpm dev:setup.",
		});
		addCheck(target, {
			name: "redis-ping",
			status: "skip",
			message: "Redis services are not running.",
		});
		return;
	}

	addCheck(target, {
		name: "redis-services",
		status: "pass",
		message: `${config.redisContainerName} and ${config.httpContainerName} are running.`,
	});
	await checkRedisPing(report, target, config);
}

async function checkRedisPing(
	report: DevServicesReport,
	target: RedisReport,
	config: DevRedisConfig,
): Promise<void> {
	try {
		const pong = await pingRedisRest(config);
		addCheck(target, {
			name: "redis-ping",
			status: "pass",
			message: pong,
		});
	} catch (error) {
		addFailedCheck(report, target, {
			name: "redis-ping",
			message: `Redis REST ping failed. ${error instanceof Error ? error.message : String(error)}`,
			remediation: "Run pnpm dev:setup.",
		});
	}
}
