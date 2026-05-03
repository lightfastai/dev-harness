export interface ResolveRelatedProjectUrlOptions {
	key?: string;
	projectName?: string;
	fallbackHost?: string;
	portlessName?: string;
	path?: string;
	cwd?: string;
	env?: Record<string, string | undefined>;
	config?: Record<string, unknown>;
	configPath?: string;
	getPortlessUrl?: (...args: unknown[]) => string | undefined;
	detectWorktreePrefix?: (...args: unknown[]) => string | undefined;
}

export function resolveRelatedProjectUrl(options?: ResolveRelatedProjectUrlOptions): string;
