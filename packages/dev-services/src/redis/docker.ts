import { spawnSync } from "node:child_process";
import {
	ensureDockerNetwork,
	inspectDockerContainer,
	runDocker,
	spawnOutput,
} from "../docker/client.js";
import type {
	DevRedisConfig,
	DevRedisServiceConfig,
} from "./config.js";
import { waitForRedisRest } from "./rest.js";

export async function ensureRedisServices(config: DevRedisConfig): Promise<void> {
	if (config.source === "env") {
		await waitForRedisRest(config);
		return;
	}

	ensureDockerNetwork(config.networkName);
	await ensureRedisContainer(config);
	await ensureRedisHttpContainer(config);
	await waitForRedisRest(config);
}

async function ensureRedisContainer(service: DevRedisServiceConfig): Promise<void> {
	const state = inspectDockerContainer(service.redisContainerName);

	if (state === "running") {
		await waitForRedisContainer(service);
		return;
	}

	if (state === "stopped") {
		runDocker(["start", service.redisContainerName], `Unable to start Docker container ${service.redisContainerName}.`);
		await waitForRedisContainer(service);
		return;
	}

	runDocker(
		[
			"run",
			"--name",
			service.redisContainerName,
			"--network",
			service.networkName,
			"-p",
			`${service.redisPort}:6379`,
			"-v",
			`${service.redisVolumeName}:/data`,
			"-d",
			service.redisImage,
		],
		`Unable to create Docker container ${service.redisContainerName}.`,
	);
	await waitForRedisContainer(service);
}

async function ensureRedisHttpContainer(config: DevRedisConfig): Promise<void> {
	const state = inspectDockerContainer(config.httpContainerName);

	if (state === "running") {
		return;
	}

	if (state === "stopped") {
		runDocker(["start", config.httpContainerName], `Unable to start Docker container ${config.httpContainerName}.`);
		return;
	}

	runDocker(
		[
			"run",
			"--name",
			config.httpContainerName,
			"--network",
			config.networkName,
			"-p",
			`${config.restPort}:80`,
			"-e",
			"SRH_MODE=env",
			"-e",
			`SRH_TOKEN=${config.token}`,
			"-e",
			`SRH_CONNECTION_STRING=redis://${config.redisContainerName}:6379`,
			"-d",
			config.httpImage,
		],
		`Unable to create Docker container ${config.httpContainerName}.`,
	);
}

async function waitForRedisContainer(service: DevRedisServiceConfig): Promise<void> {
	let lastError = "";

	for (let attempt = 0; attempt < 40; attempt++) {
		const result = spawnSync(
			"docker",
			["exec", service.redisContainerName, "redis-cli", "ping"],
			{
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			},
		);

		if (result.status === 0 && result.stdout.trim() === "PONG") {
			return;
		}
		lastError = spawnOutput(result.stderr) || spawnOutput(result.stdout);
		await new Promise((resolve) => setTimeout(resolve, 500));
	}

	throw new Error(`Timed out waiting for ${service.redisContainerName} to accept Redis connections. ${lastError.trim()}`);
}
