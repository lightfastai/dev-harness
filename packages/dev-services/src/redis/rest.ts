import type { DevRedisConfig } from "./config.js";

export async function waitForRedisRest(config: Pick<DevRedisConfig, "restUrl" | "token" | "httpContainerName">): Promise<void> {
	let lastError = "";

	for (let attempt = 0; attempt < 40; attempt++) {
		try {
			await pingRedisRest(config);
			return;
		} catch (error) {
			lastError = error instanceof Error ? error.message : String(error);
			await new Promise((resolve) => setTimeout(resolve, 500));
		}
	}

	throw new Error(`Timed out waiting for ${config.httpContainerName} to accept Redis REST requests. ${lastError}`);
}

export async function pingRedisRest(config: Pick<DevRedisConfig, "restUrl" | "token">): Promise<string> {
	const response = await fetch(config.restUrl, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${config.token}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(["PING"]),
	});
	const body = await response.json() as { result?: unknown; error?: string };

	if (!response.ok || body.error) {
		throw new Error(body.error ?? `HTTP ${response.status}`);
	}
	if (body.result !== "PONG") {
		throw new Error(`Unexpected Redis PING response: ${JSON.stringify(body.result)}`);
	}
	return body.result;
}
