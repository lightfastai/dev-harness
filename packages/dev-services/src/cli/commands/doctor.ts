import { checkDockerAvailable } from "../../docker/checks.js";
import { checkPostgresDoctor } from "../../postgres/checks.js";
import { checkRedisDoctor } from "../../redis/checks.js";
import {
	createReport,
	finalizeReport,
	formatPostgresReport,
	formatProjectReport,
	formatRedisReport,
	printDoctorReport,
	recordFailure,
} from "../../reports/format.js";
import type { DevServicesReport } from "../../reports/types.js";
import { parseOptions } from "../args.js";
import { resolveDevServiceConfigsFromOptions } from "../resolve.js";
import type { CliOptions } from "../types.js";

export async function handleDoctor(args: string[]): Promise<void> {
	const { options } = parseOptions(args);
	const report = await runDoctor(options);

	if (options.json) {
		console.log(JSON.stringify(report));
	} else {
		printDoctorReport(report);
	}

	if (report.status === "fail") {
		process.exit(1);
	}
}

async function runDoctor(options: CliOptions): Promise<DevServicesReport> {
	const report = createReport();
	const dockerAvailable = checkDockerAvailable(report);

	try {
		const { identity, postgres, redis } = resolveDevServiceConfigsFromOptions(options);
		report.project = formatProjectReport(identity);
		report.postgres = formatPostgresReport(postgres);
		report.redis = formatRedisReport(redis);

		checkPostgresDoctor(report, report.postgres, postgres, dockerAvailable, options.postgresTable);
		await checkRedisDoctor(report, report.redis, redis, dockerAvailable);
	} catch (error) {
		recordFailure(report, error instanceof Error ? error.message : String(error), "Run from a repo containing related-projects.json or pass --config <path>.");
		finalizeReport(report);
		return report;
	}

	finalizeReport(report);
	return report;
}
