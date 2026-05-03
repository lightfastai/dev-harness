import { getPortlessMfeDevOrigins } from "./index.js";

export function withPortlessMfeDev(nextConfig = {}, options = {}) {
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
	};
}

export { getPortlessMfeDevOrigins };

function unique(values) {
	return Array.from(new Set(values.filter(Boolean)));
}
