import { getPortlessProxyOrigins } from "./index.js";
import type { GetPortlessProxyOriginsOptions } from "./index.js";

export interface NextConfigWithPortlessProxy {
	allowedDevOrigins?: string[];
	experimental?: {
		serverActions?: {
			allowedOrigins?: string[];
		};
	};
}

export interface WithPortlessProxyOptions extends GetPortlessProxyOriginsOptions {
	origins?: string[];
	serverActions?: boolean | { includePort?: boolean | "both" };
}

export function withPortlessProxy<T extends object = object>(
	nextConfig: T & NextConfigWithPortlessProxy = {} as T & NextConfigWithPortlessProxy,
	options: WithPortlessProxyOptions = {},
): T & NextConfigWithPortlessProxy {
	const { serverActions, origins: providedOrigins, ...originOptions } = options;

	const devOrigins = providedOrigins ?? getPortlessProxyOrigins({
		...originOptions,
		allowMissingConfig: true,
	});

	if (!devOrigins.length) {
		return nextConfig;
	}

	const next: T & NextConfigWithPortlessProxy = {
		...nextConfig,
		allowedDevOrigins: unique([
			...(nextConfig.allowedDevOrigins ?? []),
			...devOrigins,
		]),
	};

	if (serverActions) {
		const includePort = typeof serverActions === "object" ? serverActions.includePort : false;
		const serverActionOrigins = providedOrigins ?? getPortlessProxyOrigins({
			...originOptions,
			allowMissingConfig: true,
			includePort,
		});

		next.experimental = {
			...nextConfig.experimental,
			serverActions: {
				...nextConfig.experimental?.serverActions,
				allowedOrigins: unique([
					...(nextConfig.experimental?.serverActions?.allowedOrigins ?? []),
					...serverActionOrigins,
				]),
			},
		};
	}

	return next;
}

export { getPortlessProxyOrigins };

function unique(values: string[]): string[] {
	return Array.from(new Set(values.filter(Boolean)));
}
