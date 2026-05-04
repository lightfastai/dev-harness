import { getPortlessMfeDevOrigins } from "./index.js";
import type { GetPortlessMfeDevOriginsOptions } from "./index.js";

export interface NextConfigWithPortlessMfeDev {
	allowedDevOrigins?: string[];
}

export interface WithPortlessMfeDevOptions extends GetPortlessMfeDevOriginsOptions {
	origins?: string[];
}

export function withPortlessMfeDev<T extends object = object>(
	nextConfig: T & NextConfigWithPortlessMfeDev = {} as T & NextConfigWithPortlessMfeDev,
	options: WithPortlessMfeDevOptions = {},
): T & NextConfigWithPortlessMfeDev {
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
	} as T & NextConfigWithPortlessMfeDev;
}

export { getPortlessMfeDevOrigins };

function unique(values: string[]): string[] {
	return Array.from(new Set(values.filter(Boolean)));
}
