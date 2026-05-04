import {
	formatSpawnFailure,
	inspectDockerContainer,
	runDockerStatus,
	spawnOutput,
} from "../docker/client.js";
import {
	addCheck,
	addFailedCheck,
} from "../reports/format.js";
import type {
	DevServicesReport,
	PostgresReport,
} from "../reports/types.js";
import type { DevPostgresConfig } from "./config.js";

export function checkPostgresDoctor(
	report: DevServicesReport,
	target: PostgresReport,
	config: DevPostgresConfig,
	dockerAvailable: boolean,
	postgresTable?: string,
): void {
	if (!dockerAvailable) {
		addFailedCheck(report, target, {
			name: "postgres-container",
			message: "Skipped Postgres checks because Docker is not available.",
			remediation: "Start Docker, then run pnpm dev:setup.",
		});
		addSkippedPostgresChecks(target, postgresTable, "Docker is not available.");
		return;
	}

	const state = inspectDockerContainer(config.containerName);
	if (state !== "running") {
		addFailedCheck(report, target, {
			name: "postgres-container",
			message: `${config.containerName} is ${state}.`,
			remediation: "Run pnpm dev:setup.",
		});
		addSkippedPostgresChecks(target, postgresTable, "Postgres container is not running.");
		return;
	}

	addCheck(target, {
		name: "postgres-container",
		status: "pass",
		message: `${config.containerName} is running.`,
	});

	if (!checkPostgresReady(report, target, config)) {
		addSkippedPostgresChecks(target, postgresTable, "Postgres is not accepting connections.");
		return;
	}

	if (!checkPostgresDatabase(report, target, config)) {
		if (postgresTable) {
			addCheck(target, {
				name: `postgres-table:${postgresTable}`,
				status: "skip",
				message: "Database does not exist.",
			});
		}
		return;
	}

	if (postgresTable) {
		checkPostgresTable(report, target, config, postgresTable);
	}
}

function checkPostgresReady(
	report: DevServicesReport,
	target: PostgresReport,
	config: DevPostgresConfig,
): boolean {
	const result = runDockerStatus([
		"exec",
		config.containerName,
		"pg_isready",
		"-U",
		config.username,
		"-d",
		"postgres",
	]);

	if (result.status === 0) {
		addCheck(target, {
			name: "postgres-ready",
			status: "pass",
			message: "Postgres accepts connections.",
		});
		return true;
	}

	addFailedCheck(report, target, {
		name: "postgres-ready",
		message: `Postgres is not ready. ${formatSpawnFailure(result)}`,
		remediation: "Run pnpm dev:setup.",
	});
	return false;
}

function checkPostgresDatabase(
	report: DevServicesReport,
	target: PostgresReport,
	config: DevPostgresConfig,
): boolean {
	const result = runDockerStatus([
		"exec",
		config.containerName,
		"psql",
		"-U",
		config.username,
		"-d",
		"postgres",
		"-tAc",
		`SELECT 1 FROM pg_database WHERE datname = '${config.databaseName.replace(/'/g, "''")}'`,
	]);

	if (result.status === 0 && spawnOutput(result.stdout).trim() === "1") {
		addCheck(target, {
			name: "postgres-database",
			status: "pass",
			message: `${config.databaseName} exists.`,
		});
		return true;
	}

	addFailedCheck(report, target, {
		name: "postgres-database",
		message: `${config.databaseName} does not exist.`,
		remediation: "Run pnpm dev:setup.",
	});
	return false;
}

function checkPostgresTable(
	report: DevServicesReport,
	target: PostgresReport,
	config: DevPostgresConfig,
	postgresTable: string,
): void {
	if (!isSafeQualifiedIdentifier(postgresTable)) {
		addFailedCheck(report, target, {
			name: `postgres-table:${postgresTable}`,
			message: `Invalid Postgres table name "${postgresTable}".`,
		});
		return;
	}

	const result = runDockerStatus([
		"exec",
		config.containerName,
		"psql",
		"-U",
		config.username,
		"-d",
		config.databaseName,
		"-tAc",
		`SELECT to_regclass('${postgresTable.replace(/'/g, "''")}') IS NOT NULL`,
	]);

	if (result.status === 0 && spawnOutput(result.stdout).trim() === "t") {
		addCheck(target, {
			name: `postgres-table:${postgresTable}`,
			status: "pass",
			message: `${postgresTable} exists.`,
		});
		return;
	}

	addFailedCheck(report, target, {
		name: `postgres-table:${postgresTable}`,
		message: `${postgresTable} is missing.`,
		remediation: "Run pnpm db:migrate.",
	});
}

function addSkippedPostgresChecks(target: PostgresReport, postgresTable: string | undefined, message: string): void {
	addCheck(target, {
		name: "postgres-ready",
		status: "skip",
		message,
	});
	addCheck(target, {
		name: "postgres-database",
		status: "skip",
		message,
	});
	if (postgresTable) {
		addCheck(target, {
			name: `postgres-table:${postgresTable}`,
			status: "skip",
			message,
		});
	}
}

function isSafeQualifiedIdentifier(value: string): boolean {
	return /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/.test(value);
}
