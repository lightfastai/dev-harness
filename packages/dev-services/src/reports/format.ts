import type { DevProjectConfig } from "@lightfastai/dev-core";
import {
	redactPostgresUrl,
	type DevPostgresConfig,
} from "../postgres/config.js";
import {
	redactRedisRestUrl,
	type DevRedisConfig,
} from "../redis/config.js";
import type {
	DevServiceCheck,
	DevServicesReport,
	PostgresReport,
	ProjectReport,
	RedisReport,
} from "./types.js";

export function createReport(): DevServicesReport {
	return {
		status: "ok",
		project: null,
		postgres: null,
		redis: null,
		failures: [],
	};
}

export function finalizeReport(report: DevServicesReport): void {
	report.status = report.failures.length ? "fail" : "ok";
}

export function formatProjectReport(project: DevProjectConfig): ProjectReport {
	return {
		name: project.name,
		root: project.root,
		configPath: project.configPath,
	};
}

export function formatPostgresReport(config: DevPostgresConfig): PostgresReport {
	return {
		databaseName: config.databaseName,
		redactedDatabaseUrl: redactPostgresUrl(config.databaseUrl),
		host: config.host,
		port: config.port,
		containerName: config.containerName,
		checks: [],
	};
}

export function formatRedisReport(config: DevRedisConfig): RedisReport {
	return {
		restUrl: config.restUrl,
		redactedRestUrl: redactRedisRestUrl(config.restUrl),
		keyPrefix: config.keyPrefix,
		redisContainerName: config.redisContainerName,
		httpContainerName: config.httpContainerName,
		checks: [],
	};
}

export function addCheck(target: { checks: DevServiceCheck[] }, check: DevServiceCheck): void {
	target.checks.push(check);
}

export function recordFailure(report: DevServicesReport, message: string, remediation?: string): void {
	const fullMessage = remediation ? `${message} ${remediation}` : message;
	if (!report.failures.includes(fullMessage)) {
		report.failures.push(fullMessage);
	}
}

export function addFailedCheck(
	report: DevServicesReport,
	target: { checks: DevServiceCheck[] },
	check: Omit<DevServiceCheck, "status">,
): void {
	const failedCheck = { ...check, status: "fail" as const };
	addCheck(target, failedCheck);
	recordFailure(report, check.message ?? check.name, check.remediation);
}

export function printSetupReport(report: DevServicesReport): void {
	if (report.status === "ok") {
		console.log("Dev services are ready.");
		printResolvedServices(report);
		return;
	}

	printFailures(report);
}

export function printDoctorReport(report: DevServicesReport): void {
	if (report.status === "ok") {
		console.log("Dev services doctor passed.");
		printResolvedServices(report);
		return;
	}

	printFailures(report);
}

function printResolvedServices(report: DevServicesReport): void {
	if (report.project) {
		console.log(`Project: ${report.project.name} (${report.project.root})`);
	}
	if (report.postgres) {
		console.log(`Postgres: ${report.postgres.databaseName} at ${report.postgres.host}:${report.postgres.port}`);
	}
	if (report.redis) {
		console.log(`Redis REST: ${report.redis.restUrl}`);
		console.log(`Redis key prefix: ${report.redis.keyPrefix}`);
	}
}

function printFailures(report: DevServicesReport): void {
	console.error("Dev services check failed.");
	for (const failure of report.failures) {
		console.error(`- ${failure}`);
	}
}
