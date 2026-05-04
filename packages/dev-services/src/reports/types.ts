export type CheckStatus = "pass" | "fail" | "skip";

export interface DevServiceCheck {
	name: string;
	status: CheckStatus;
	message?: string;
	remediation?: string;
}

export interface ProjectReport {
	name: string;
	root: string;
	configPath: string;
}

export interface PostgresReport {
	databaseName: string;
	redactedDatabaseUrl: string;
	host: string;
	port: number;
	containerName: string;
	created?: boolean;
	checks: DevServiceCheck[];
}

export interface RedisReport {
	restUrl: string;
	redactedRestUrl: string;
	keyPrefix: string;
	redisContainerName: string;
	httpContainerName: string;
	checks: DevServiceCheck[];
}

export interface DevServicesReport {
	status: "ok" | "fail";
	project: ProjectReport | null;
	postgres: PostgresReport | null;
	redis: RedisReport | null;
	failures: string[];
}
