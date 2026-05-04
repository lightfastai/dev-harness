export interface InngestDevSyncTarget {
	appName: string;
	url: string;
}

export interface BuildInngestDevSyncTargetsOptions {
	result: {
		appUrls: Record<string, string>;
		localAppNames?: string[];
	};
	localApps?: string[];
	servePath?: string;
}

export interface InngestDevSyncLogger {
	log(message: string): void;
	warn(message: string): void;
}

export interface InngestDevSyncRuntime {
	targets: InngestDevSyncTarget[];
	stop(): void;
}

export interface InngestDevSyncResult {
	status: "synced" | "skipped" | "retry";
	statusCode?: number;
	reason?: string;
}

type InngestDevSyncFetch = (
	input: string | URL,
	init?: RequestInit,
) => Promise<Pick<Response, "status">>;

export interface SyncInngestDevTargetOptions {
	fetchImpl?: InngestDevSyncFetch;
	requestTimeoutMs?: number;
}

export interface StartInngestDevSyncOptions extends SyncInngestDevTargetOptions {
	targets: InngestDevSyncTarget[];
	enabled?: boolean;
	logger?: InngestDevSyncLogger;
	intervalMs?: number;
	initialDelayMs?: number;
	skipAfterMs?: number;
}

export const DEFAULT_INNGEST_SERVE_PATH = "/api/inngest";
export const DEFAULT_INNGEST_SYNC_INTERVAL_MS = 2_000;
export const DEFAULT_INNGEST_SYNC_REQUEST_TIMEOUT_MS = 2_000;
export const DEFAULT_INNGEST_SYNC_SKIP_GRACE_MS = 15_000;

export function isInngestDevSyncEnabled(env: Record<string, string | undefined> = process.env): boolean {
	const value = env.PORTLESS_MFE_INNGEST_SYNC?.toLowerCase();
	return value !== "0" && value !== "false" && value !== "off";
}

export function buildInngestDevSyncTargets({
	result,
	localApps = result.localAppNames ?? Object.keys(result.appUrls),
	servePath = DEFAULT_INNGEST_SERVE_PATH,
}: BuildInngestDevSyncTargetsOptions): InngestDevSyncTarget[] {
	return localApps.flatMap((appName) => {
		const appUrl = result.appUrls[appName];
		if (!appUrl) {
			return [];
		}

		return [{
			appName,
			url: new URL(servePath, appUrl).toString(),
		}];
	});
}

export async function syncInngestDevTarget(
	target: InngestDevSyncTarget,
	{
		fetchImpl = globalThis.fetch,
		requestTimeoutMs = DEFAULT_INNGEST_SYNC_REQUEST_TIMEOUT_MS,
	}: SyncInngestDevTargetOptions = {},
): Promise<InngestDevSyncResult> {
	if (!fetchImpl) {
		return {
			status: "retry",
			reason: "fetch is not available",
		};
	}

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

	try {
		const response = await fetchImpl(target.url, {
			method: "PUT",
			signal: controller.signal,
		});

		if (response.status >= 200 && response.status < 300) {
			return {
				status: "synced",
				statusCode: response.status,
			};
		}

		if (response.status === 404 || response.status === 405) {
			return {
				status: "skipped",
				statusCode: response.status,
				reason: `HTTP ${response.status}`,
			};
		}

		return {
			status: "retry",
			statusCode: response.status,
			reason: `HTTP ${response.status}`,
		};
	} catch (error) {
		return {
			status: "retry",
			reason: error instanceof Error ? error.message : String(error),
		};
	} finally {
		clearTimeout(timeout);
	}
}

export function startInngestDevSync({
	targets,
	enabled = true,
	logger = console,
	intervalMs = DEFAULT_INNGEST_SYNC_INTERVAL_MS,
	initialDelayMs = 1_000,
	skipAfterMs = DEFAULT_INNGEST_SYNC_SKIP_GRACE_MS,
	fetchImpl = globalThis.fetch,
	requestTimeoutMs = DEFAULT_INNGEST_SYNC_REQUEST_TIMEOUT_MS,
}: StartInngestDevSyncOptions): InngestDevSyncRuntime {
	const timers = new Set<NodeJS.Timeout>();
	const targetStartedAt = new Map<string, number>();
	let stopped = false;

	const runtime: InngestDevSyncRuntime = {
		targets,
		stop() {
			stopped = true;
			for (const timer of timers) {
				clearTimeout(timer);
			}
			timers.clear();
		},
	};

	if (!enabled || targets.length === 0) {
		return runtime;
	}

	const schedule = (target: InngestDevSyncTarget, delayMs: number) => {
		if (stopped) {
			return;
		}

		const timer = setTimeout(() => {
			timers.delete(timer);
			void attempt(target);
		}, delayMs);
		timers.add(timer);
	};

	const attempt = async (target: InngestDevSyncTarget) => {
		if (stopped) {
			return;
		}
		const targetKey = `${target.appName}:${target.url}`;
		const startedAt = targetStartedAt.get(targetKey) ?? Date.now();
		targetStartedAt.set(targetKey, startedAt);

		const result = await syncInngestDevTarget(target, {
			fetchImpl,
			requestTimeoutMs,
		});

		if (stopped) {
			return;
		}

		if (result.status === "synced") {
			logger.log(`Inngest synced ${target.appName}: ${target.url}`);
			return;
		}

		if (result.status === "skipped") {
			if (Date.now() - startedAt < skipAfterMs) {
				schedule(target, intervalMs);
				return;
			}
			logger.log(`Inngest sync skipped ${target.appName}: ${result.reason ?? "not available"}`);
			return;
		}

		schedule(target, intervalMs);
	};

	for (const target of targets) {
		schedule(target, initialDelayMs);
	}

	return runtime;
}
