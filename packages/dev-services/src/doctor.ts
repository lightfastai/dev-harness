import { checkDockerAvailable } from "./docker/checks.js";
import { checkPostgresDoctor } from "./postgres/checks.js";
import { checkRedisDoctor } from "./redis/checks.js";
import {
	createReport,
	finalizeReport,
	formatPostgresReport,
	formatProjectReport,
	formatRedisReport,
	recordFailure,
} from "./reports/format.js";
import type { DevServicesReport } from "./reports/types.js";
import { resolveDevServiceConfigs } from "./resolve.js";
import type { DevServicesDoctorOptions } from "./options.js";

export async function runDevServicesDoctor(options: DevServicesDoctorOptions = {}): Promise<DevServicesReport> {
	const report = createReport();
	const dockerAvailable = checkDockerAvailable(report);

	try {
		const { identity, postgres, redis } = resolveDevServiceConfigs(options);
		report.project = formatProjectReport(identity);
		report.postgres = formatPostgresReport(postgres);
		report.redis = formatRedisReport(redis);

		checkPostgresDoctor(report, report.postgres, postgres, dockerAvailable, options.postgresTable);
		await checkRedisDoctor(report, report.redis, redis, dockerAvailable);
	} catch (error) {
		recordFailure(report, error instanceof Error ? error.message : String(error), "Run from a repo containing lightfast.dev.json or pass --config <path>.");
		finalizeReport(report);
		return report;
	}

	finalizeReport(report);
	return report;
}
