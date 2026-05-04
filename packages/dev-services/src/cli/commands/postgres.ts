import {
	redactPostgresUrl,
	resolveDevPostgresServiceConfig,
} from "../../postgres/config.js";
import { ensurePostgresContainer, ensurePostgresDatabase } from "../../postgres/docker.js";
import { parseOptions } from "../args.js";
import { resolvePostgresConfigFromOptions } from "../resolve.js";

export function handlePostgresUrl(args: string[]): void {
	const { options } = parseOptions(args);
	const config = resolvePostgresConfigFromOptions(options);

	if (options.json) {
		console.log(JSON.stringify({
			databaseName: config.databaseName,
			databaseUrl: config.databaseUrl,
			redactedDatabaseUrl: redactPostgresUrl(config.databaseUrl),
			source: config.source,
			host: config.host,
			port: config.port,
			containerName: config.containerName,
		}));
		return;
	}

	console.log(config.databaseUrl);
}

export async function handlePostgresUp(args: string[]): Promise<void> {
	const { options } = parseOptions(args);
	const service = resolveDevPostgresServiceConfig(process.env);
	await ensurePostgresContainer(service);

	if (options.json) {
		console.log(JSON.stringify({
			containerName: service.containerName,
			image: service.image,
			host: service.host,
			port: service.port,
			volumeName: service.volumeName,
		}));
		return;
	}

	console.log(`Postgres is running at ${service.host}:${service.port} (${service.containerName})`);
}

export async function handlePostgresCreate(args: string[]): Promise<void> {
	const { options } = parseOptions(args);
	const config = resolvePostgresConfigFromOptions(options);
	await ensurePostgresContainer(config);
	const created = await ensurePostgresDatabase(config);

	if (options.json) {
		console.log(JSON.stringify({
			databaseName: config.databaseName,
			databaseUrl: config.databaseUrl,
			redactedDatabaseUrl: redactPostgresUrl(config.databaseUrl),
			created,
		}));
		return;
	}

	console.log(
		`${created ? "Created" : "Reused"} dev Postgres database ${config.databaseName}`,
	);
}
