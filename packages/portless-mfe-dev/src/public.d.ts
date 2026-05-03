export interface PortlessMfeConfig {
	root?: string;
	configPath?: string;
	portless?: {
		name?: string;
		port?: number | string;
		https?: boolean;
		tld?: string;
	};
	microfrontends?: {
		config?: string;
		apps?: Record<string, string | {
			dir?: string;
			path?: string;
			portlessName?: string;
		}>;
		proxyPortRange?: {
			min?: number | string;
			max?: number | string;
		};
	};
	relatedProjects?: Record<string, {
		projectName?: string;
		fallbackHost?: string;
		portlessName?: string;
		path?: string;
	}>;
}

export interface RuntimeIdentity {
	name: string;
	baseName: string;
	targetUrl: string;
	worktreePrefix?: string;
}

export interface ResolveTargetUrlOptions {
	name?: string;
	path?: string;
	targetUrl?: string;
	cwd?: string;
	env?: Record<string, string | undefined>;
	config?: PortlessMfeConfig;
	configPath?: string;
}

export interface ResolveRuntimeIdentityOptions {
	name?: string;
	targetUrl: string;
	appName?: string;
	cwd?: string;
	env?: Record<string, string | undefined>;
	config?: PortlessMfeConfig;
}

export interface ResolvePortlessMfeRuntimeOptions extends ResolveTargetUrlOptions {
	appName?: string;
	configPath?: string;
}

export interface ResolvePortlessApplicationUrlOptions extends ResolveTargetUrlOptions {
	app: string;
	configPath?: string;
}

export function resolvePortlessUrl(options?: ResolveTargetUrlOptions): string;
export function resolveTargetUrl(options?: ResolveTargetUrlOptions): string;
export function resolveRuntimeIdentity(options: ResolveRuntimeIdentityOptions): RuntimeIdentity;
export function resolvePortlessApplicationUrl(options: ResolvePortlessApplicationUrlOptions): string;
export function resolvePortlessMfeUrl(options?: ResolvePortlessMfeRuntimeOptions): string;
export function resolvePortlessMfeRuntime(options?: ResolvePortlessMfeRuntimeOptions): RuntimeIdentity;
export function createVercelMicrofrontendsDevConfig(options?: Record<string, unknown>): Promise<Record<string, unknown>>;
