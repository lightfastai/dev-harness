import { printHelp } from "./help.js";
import type {
	CliOptions,
	ParsedCommandArgs,
} from "./types.js";

export function parseCommandArgs(args: string[]): ParsedCommandArgs {
	const separatorIndex = args.indexOf("--");
	const optionArgs = separatorIndex === -1 ? [] : args.slice(0, separatorIndex);
	const commandArgs = separatorIndex === -1 ? args : args.slice(separatorIndex + 1);
	const { options } = parseOptions(optionArgs);
	return { options, commandArgs };
}

export function parseOptions(args: string[]): { options: CliOptions } {
	const options: CliOptions = { mfeApps: [], appUrls: [] };

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];

		switch (arg) {
			case "--app-name":
				options.appName = readOptionValue(args, ++i, arg);
				break;
			case "--config":
				options.configPath = readOptionValue(args, ++i, arg);
				break;
			case "--postgres-table":
				options.postgresTable = readOptionValue(args, ++i, arg);
				break;
			case "--mfe-app":
				options.mfeApps.push(readOptionValue(args, ++i, arg));
				break;
			case "--app-url":
				options.appUrls.push(parseAppUrl(readOptionValue(args, ++i, arg)));
				break;
			case "--serve-path":
				options.servePath = readOptionValue(args, ++i, arg);
				break;
			case "--no-inngest-sync":
				options.inngestSync = false;
				break;
			case "--json":
				options.json = true;
				break;
			case "-h":
			case "--help":
				printHelp();
				process.exit(0);
				break;
			default:
				throw new Error(`Unknown option "${arg}".`);
		}
	}

	return { options };
}

function parseAppUrl(value: string): { appName: string; url: string } {
	const separatorIndex = value.indexOf("=");
	if (separatorIndex > 0) {
		return {
			appName: value.slice(0, separatorIndex),
			url: value.slice(separatorIndex + 1),
		};
	}

	const hostname = new URL(value).hostname;
	return {
		appName: hostname.split(".")[0] || hostname,
		url: value,
	};
}

function readOptionValue(args: string[], index: number, option: string): string {
	const value = args[index];
	if (!value || value.startsWith("--")) {
		throw new Error(`${option} requires a value.`);
	}
	return value;
}
