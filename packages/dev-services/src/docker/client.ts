import { spawnSync } from "node:child_process";

export type DockerContainerState = "missing" | "running" | "stopped";

export function inspectDockerContainer(containerName: string): DockerContainerState {
	const result = spawnSync(
		"docker",
		["inspect", "-f", "{{.State.Running}}", containerName],
		{
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		},
	);

	if (result.error) {
		throw result.error;
	}
	if (result.status !== 0) {
		return "missing";
	}

	return result.stdout.trim() === "true" ? "running" : "stopped";
}

export function runDocker(args: string[], errorMessage: string): string {
	const result = spawnSync("docker", args, {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});

	if (result.error) {
		throw result.error;
	}
	if (result.status !== 0) {
		throw new Error(`${errorMessage}\n${result.stderr || result.stdout}`);
	}

	return result.stdout;
}

export function runDockerStatus(args: string[]): ReturnType<typeof spawnSync> {
	return spawnSync("docker", args, {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
}

export function ensureDockerNetwork(networkName: string): void {
	const result = spawnSync(
		"docker",
		["network", "inspect", networkName],
		{
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		},
	);

	if (result.error) {
		throw result.error;
	}
	if (result.status === 0) {
		return;
	}

	runDocker(
		["network", "create", networkName],
		`Unable to create Docker network ${networkName}.`,
	);
}

export function formatSpawnFailure(result: ReturnType<typeof spawnSync>): string {
	if (result.error) {
		return result.error.message;
	}
	return (spawnOutput(result.stderr) || spawnOutput(result.stdout) || `exit ${result.status ?? "unknown"}`).trim();
}

export function spawnOutput(value: string | NodeJS.ArrayBufferView | null | undefined): string {
	return typeof value === "string" ? value : value?.toString() ?? "";
}
