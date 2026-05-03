import type { NextConfig } from "next";
import type { PortlessMfeConfig } from "./public.js";

export interface PortlessMfeDevOriginsOptions {
	name?: string;
	tld?: string;
	cwd?: string;
	env?: Record<string, string | undefined>;
	config?: PortlessMfeConfig;
	configPath?: string;
	includeWildcard?: boolean;
}

export interface WithPortlessMfeDevOptions extends PortlessMfeDevOriginsOptions {
	origins?: string[];
}

export function getPortlessMfeDevOrigins(options?: PortlessMfeDevOriginsOptions): string[];
export function withPortlessMfeDev<T extends NextConfig>(
	nextConfig?: T,
	options?: WithPortlessMfeDevOptions,
): T & NextConfig;
