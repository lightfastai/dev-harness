import { spawnSync } from "node:child_process";
import type {
	DevPostgresConfig,
	DevPostgresServiceConfig,
} from "./config.js";
import {
	inspectDockerContainer,
	runDocker,
	spawnOutput,
} from "../docker/client.js";

export async function ensurePostgresContainer(service: DevPostgresServiceConfig): Promise<void> {
	const state = inspectDockerContainer(service.containerName);

	if (state === "running") {
		await waitForPostgres(service);
		return;
	}

	if (state === "stopped") {
		runDocker(["start", service.containerName], `Unable to start Docker container ${service.containerName}.`);
		await waitForPostgres(service);
		return;
	}

	runDocker(
		[
			"run",
			"--name",
			service.containerName,
			"-e",
			`POSTGRES_USER=${service.username}`,
			"-e",
			`POSTGRES_PASSWORD=${service.password}`,
			"-p",
			`${service.port}:5432`,
			"-v",
			`${service.volumeName}:/var/lib/postgresql/data`,
			"-d",
			service.image,
		],
		`Unable to create Docker container ${service.containerName}.`,
	);
	await waitForPostgres(service);
}

export async function ensurePostgresDatabase(config: DevPostgresConfig): Promise<boolean> {
	const exists = runDocker(
		[
			"exec",
			config.containerName,
			"psql",
			"-U",
			config.username,
			"-d",
			"postgres",
			"-tAc",
			`SELECT 1 FROM pg_database WHERE datname = '${config.databaseName.replace(/'/g, "''")}'`,
		],
		`Unable to inspect Postgres database ${config.databaseName}.`,
	).trim() === "1";

	if (exists) {
		return false;
	}

	runDocker(
		[
			"exec",
			config.containerName,
			"createdb",
			"-U",
			config.username,
			config.databaseName,
		],
		`Unable to create Postgres database ${config.databaseName}.`,
	);
	return true;
}

async function waitForPostgres(service: DevPostgresServiceConfig): Promise<void> {
	let lastError = "";

	for (let attempt = 0; attempt < 40; attempt++) {
		const result = runPostgresReadyCheck(service);

		if (result.status === 0) {
			return;
		}
		lastError = spawnOutput(result.stderr) || spawnOutput(result.stdout);
		await new Promise((resolve) => setTimeout(resolve, 500));
	}

	throw new Error(`Timed out waiting for ${service.containerName} to accept Postgres connections. ${lastError.trim()}`);
}

function runPostgresReadyCheck(service: DevPostgresServiceConfig): ReturnType<typeof spawnSync> {
	return spawnSync(
		"docker",
		[
			"exec",
			service.containerName,
			"pg_isready",
			"-U",
			service.username,
			"-d",
			"postgres",
		],
		{
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
}
