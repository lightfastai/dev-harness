import { ensurePostgresContainer, ensurePostgresDatabase } from "./postgres/docker.js";
import { ensureRedisServices } from "./redis/docker.js";
import { pingRedisRest } from "./redis/rest.js";
import {
	addCheck,
	createReport,
	finalizeReport,
	formatPostgresReport,
	formatProjectReport,
	formatRedisReport,
	recordFailure,
} from "./reports/format.js";
import type { DevServicesReport } from "./reports/types.js";
import { resolveDevServiceConfigs } from "./resolve.js";
import type { DevServiceOptions } from "./options.js";

export async function runDevServicesSetup(options: DevServiceOptions = {}): Promise<DevServicesReport> {
	const report = createReport();

	try {
		const { identity, postgres, redis } = resolveDevServiceConfigs(options);
		report.project = formatProjectReport(identity);
		report.postgres = formatPostgresReport(postgres);
		report.redis = formatRedisReport(redis);

		await ensurePostgresContainer(postgres);
		addCheck(report.postgres, {
			name: "postgres-container",
			status: "pass",
			message: `${postgres.containerName} is running at ${postgres.host}:${postgres.port}`,
		});

		const created = await ensurePostgresDatabase(postgres);
		report.postgres.created = created;
		addCheck(report.postgres, {
			name: "postgres-database",
			status: "pass",
			message: `${created ? "Created" : "Reused"} database ${postgres.databaseName}`,
		});

		await ensureRedisServices(redis);
		addCheck(report.redis, {
			name: "redis-services",
			status: "pass",
			message: `${redis.httpContainerName} is serving ${redis.restUrl}`,
		});

		const pong = await pingRedisRest(redis);
		addCheck(report.redis, {
			name: "redis-ping",
			status: "pass",
			message: pong,
		});
	} catch (error) {
		recordFailure(report, error instanceof Error ? error.message : String(error));
	}

	finalizeReport(report);
	return report;
}
