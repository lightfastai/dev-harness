import { spawnSync } from "node:child_process";
import type { DevServicesReport } from "../reports/types.js";
import { formatSpawnFailure } from "./client.js";
import { recordFailure } from "../reports/format.js";

export function checkDockerAvailable(report: DevServicesReport): boolean {
	const result = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});

	if (result.status === 0) {
		return true;
	}

	recordFailure(
		report,
		`Docker is not available. ${formatSpawnFailure(result)}`,
		"Start Docker, then run pnpm dev:setup.",
	);
	return false;
}
