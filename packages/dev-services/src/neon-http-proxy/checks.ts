import { inspectDockerContainer } from "../docker/client.js";
import {
	addCheck,
	addFailedCheck,
} from "../reports/format.js";
import type {
	DevServicesReport,
	NeonHttpProxyReport,
} from "../reports/types.js";
import type { DevNeonHttpProxyConfig } from "./config.js";

export async function checkNeonHttpProxyDoctor(
	report: DevServicesReport,
	target: NeonHttpProxyReport,
	config: DevNeonHttpProxyConfig,
	dockerAvailable: boolean,
): Promise<void> {
	if (!dockerAvailable) {
		addFailedCheck(report, target, {
			name: "neon-http-proxy-container",
			message: "Skipped Neon HTTP proxy checks because Docker is not available.",
			remediation: "Start Docker, then run pnpm dev:setup.",
		});
		addCheck(target, {
			name: "neon-http-proxy-ready",
			status: "skip",
			message: "Docker is not available.",
		});
		return;
	}

	const state = inspectDockerContainer(config.containerName);
	if (state !== "running") {
		addFailedCheck(report, target, {
			name: "neon-http-proxy-container",
			message: `${config.containerName} is ${state}.`,
			remediation: "Run pnpm dev:setup.",
		});
		addCheck(target, {
			name: "neon-http-proxy-ready",
			status: "skip",
			message: "Neon HTTP proxy container is not running.",
		});
		return;
	}

	addCheck(target, {
		name: "neon-http-proxy-container",
		status: "pass",
		message: `${config.containerName} is running.`,
	});

	await checkNeonHttpProxyReady(report, target, config);
}

async function checkNeonHttpProxyReady(
	report: DevServicesReport,
	target: NeonHttpProxyReport,
	config: DevNeonHttpProxyConfig,
): Promise<void> {
	try {
		const response = await fetch(`http://${config.host}:${config.hostPort}/sql`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ query: "SELECT 1", params: [] }),
		});

		if (response.status < 500) {
			addCheck(target, {
				name: "neon-http-proxy-ready",
				status: "pass",
				message: `Neon HTTP proxy responded with HTTP ${response.status}.`,
			});
			return;
		}

		addFailedCheck(report, target, {
			name: "neon-http-proxy-ready",
			message: `Neon HTTP proxy returned HTTP ${response.status}.`,
			remediation: "Run pnpm dev:setup or inspect proxy logs with `docker logs " +
				config.containerName + "`.",
		});
	} catch (error) {
		addFailedCheck(report, target, {
			name: "neon-http-proxy-ready",
			message: `Neon HTTP proxy ready check failed. ${error instanceof Error ? error.message : String(error)}`,
			remediation: "Run pnpm dev:setup.",
		});
	}
}
