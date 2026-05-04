import { ensurePostgresContainer, ensurePostgresDatabase } from "../../postgres/docker.js";
import { ensureRedisServices } from "../../redis/docker.js";
import { pingRedisRest } from "../../redis/rest.js";
import {
	addCheck,
	createReport,
	finalizeReport,
	formatPostgresReport,
	formatProjectReport,
	formatRedisReport,
	printSetupReport,
	recordFailure,
} from "../../reports/format.js";
import type { DevServicesReport } from "../../reports/types.js";
import { parseOptions } from "../args.js";
import { resolveDevServiceConfigsFromOptions } from "../resolve.js";
import type { CliOptions } from "../types.js";

export async function handleSetup(args: string[]): Promise<void> {
	const { options } = parseOptions(args);
	const report = await runSetup(options);

	if (options.json) {
		console.log(JSON.stringify(report));
	} else {
		printSetupReport(report);
	}

	if (report.status === "fail") {
		process.exit(1);
	}
}

async function runSetup(options: CliOptions): Promise<DevServicesReport> {
	const report = createReport();

	try {
		const { identity, postgres, redis } = resolveDevServiceConfigsFromOptions(options);
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
