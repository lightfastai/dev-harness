import { getPortlessMfeDevOrigins } from "./index.js";
import type { GetPortlessMfeDevOriginsOptions } from "./index.js";

export interface NextConfigWithPortlessMfeDev {
	allowedDevOrigins?: string[];
	[key: string]: unknown;
}

export interface WithPortlessMfeDevOptions extends GetPortlessMfeDevOriginsOptions {
	origins?: string[];
}

export function withPortlessMfeDev<T extends NextConfigWithPortlessMfeDev>(
	nextConfig: T = {} as T,
	options: WithPortlessMfeDevOptions = {},
): T {
	const origins = options.origins ?? getPortlessMfeDevOrigins({
		...options,
		allowMissingConfig: true,
	});

	if (!origins.length) {
		return nextConfig;
	}

	return {
		...nextConfig,
		allowedDevOrigins: unique([
			...(nextConfig.allowedDevOrigins ?? []),
			...origins,
		]),
	} as T;
}

export { getPortlessMfeDevOrigins };

function unique(values: string[]): string[] {
	return Array.from(new Set(values.filter(Boolean)));
}
