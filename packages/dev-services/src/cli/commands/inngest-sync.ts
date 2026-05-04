import { spawn } from "node:child_process";
import {
	buildInngestDevSyncTargets,
	isInngestDevSyncEnabled,
	startInngestDevSync,
} from "../../inngest/sync.js";
import { parseCommandArgs } from "../args.js";
import { printHelp } from "../help.js";
import { signalExitCode } from "../signals.js";
import type { CliOptions } from "../types.js";

const SIGNALS: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];

export async function handleInngestSync(args: string[]): Promise<void> {
	if (args.includes("-h") || args.includes("--help")) {
		printHelp();
		return;
	}

	const { options, commandArgs } = parseCommandArgs(args);
	if (!commandArgs.length) {
		throw new Error("Usage: lightfast-dev-services inngest-sync [options] -- <command> [...args]");
	}

	const targets = options.inngestSync === false || !isInngestDevSyncEnabled(process.env)
		? []
		: await resolveInngestTargets(options);
	const syncRuntime = startInngestDevSync({
		targets,
		enabled: targets.length > 0,
	});
	const child = spawn(commandArgs[0], commandArgs.slice(1), {
		cwd: process.cwd(),
		env: process.env,
		stdio: "inherit",
	});
	let shuttingDown = false;

	const shutdown = (signal: NodeJS.Signals) => {
		shuttingDown = true;
		syncRuntime.stop();
		if (!child.killed) {
			child.kill(signal);
		}
	};

	for (const signal of SIGNALS) {
		process.on(signal, () => shutdown(signal));
	}

	child.on("exit", (code, signal) => {
		if (!shuttingDown) {
			syncRuntime.stop();
		}
		if (signal) {
			process.exit(signalExitCode(signal));
			return;
		}
		process.exit(code ?? 0);
	});
}

async function resolveInngestTargets(options: CliOptions) {
	const explicitTargets = buildInngestDevSyncTargets({
		result: {
			appUrls: Object.fromEntries(
				options.appUrls.map(({ appName, url }) => [appName, url]),
			),
			localAppNames: options.appUrls.map(({ appName }) => appName),
		},
		servePath: options.servePath,
	});

	if (!options.mfeApps.length) {
		return explicitTargets;
	}

	const relatedProjects = await loadRelatedProjectsApi();
	const appUrls = Object.fromEntries(
		options.mfeApps.map((appName) => [
			appName,
			relatedProjects.resolvePortlessApplicationUrl({
				app: appName,
				cwd: process.cwd(),
				env: process.env,
			}),
		]),
	);

	return [
		...explicitTargets,
		...buildInngestDevSyncTargets({
			result: {
				appUrls,
				localAppNames: options.mfeApps,
			},
			servePath: options.servePath,
		}),
	];
}

async function loadRelatedProjectsApi(): Promise<{
	resolvePortlessApplicationUrl(options: {
		app: string;
		cwd?: string;
		env?: Record<string, string | undefined>;
	}): string;
}> {
	const moduleName = "@lightfastai/related-projects";
	try {
		return await import(moduleName) as {
			resolvePortlessApplicationUrl(options: {
				app: string;
				cwd?: string;
				env?: Record<string, string | undefined>;
			}): string;
		};
	} catch (error) {
		throw new Error(
			`Unable to resolve MFE app URLs. Install/build @lightfastai/related-projects or pass --app-url <name=url>. ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}
