import {
	ensureContainerOnNetwork,
	ensureDockerNetwork,
	inspectDockerContainer,
	runDocker,
} from "../docker/client.js";
import type { DevNeonHttpProxyConfig } from "./config.js";

export async function ensureNeonHttpProxyContainer(
	config: DevNeonHttpProxyConfig,
): Promise<void> {
	ensureDockerNetwork(config.networkName);

	const state = inspectDockerContainer(config.containerName);

	if (state === "running") {
		ensureContainerOnNetwork(config.containerName, config.networkName);
		await waitForNeonHttpProxy(config);
		return;
	}

	if (state === "stopped") {
		runDocker(
			["start", config.containerName],
			`Unable to start Docker container ${config.containerName}.`,
		);
		ensureContainerOnNetwork(config.containerName, config.networkName);
		await waitForNeonHttpProxy(config);
		return;
	}

	runDocker(
		[
			"run",
			"--name",
			config.containerName,
			"--network",
			config.networkName,
			"-p",
			`${config.hostPort}:4444`,
			"-e",
			`PG_CONNECTION_STRING=${config.backendConnectionString}`,
			"-d",
			config.image,
		],
		`Unable to create Docker container ${config.containerName}.`,
	);
	await waitForNeonHttpProxy(config);
}

export async function waitForNeonHttpProxy(
	config: Pick<DevNeonHttpProxyConfig, "host" | "hostPort" | "containerName">,
	attempts = 40,
): Promise<void> {
	let lastError = "";

	for (let attempt = 0; attempt < attempts; attempt++) {
		try {
			const response = await fetch(`http://${config.host}:${config.hostPort}/sql`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ query: "SELECT 1", params: [] }),
			});

			if (response.status < 500) {
				return;
			}
			lastError = `HTTP ${response.status}`;
		} catch (error) {
			lastError = error instanceof Error ? error.message : String(error);
		}
		await new Promise((resolve) => setTimeout(resolve, 500));
	}

	throw new Error(
		`Timed out waiting for ${config.containerName} to accept Neon HTTP requests on ${config.host}:${config.hostPort}. ${lastError}`.trim(),
	);
}
