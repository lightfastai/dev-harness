export interface CliOptions {
	appName?: string;
	configPath?: string;
	json?: boolean;
	postgresTable?: string;
	mfeApps: string[];
	appUrls: Array<{ appName: string; url: string }>;
	servePath?: string;
	inngestSync?: boolean;
}

export interface ParsedCommandArgs {
	options: CliOptions;
	commandArgs: string[];
}
