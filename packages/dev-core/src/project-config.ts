import fs from "node:fs";
import path from "node:path";

export interface DevProjectConfig {
	root: string;
	configPath: string;
	name: string;
}

export interface ResolveDevProjectConfigOptions {
	cwd?: string;
	configPath?: string;
}

export const DEV_CONFIG_FILENAME = "lightfast.dev.json";

export function resolveDevProjectConfig({
	cwd = process.cwd(),
	configPath,
}: ResolveDevProjectConfigOptions = {}): DevProjectConfig {
	const resolvedPath = configPath
		? path.resolve(cwd, configPath)
		: findDevConfig(cwd);

	if (!resolvedPath) {
		throw new Error(`Could not find ${DEV_CONFIG_FILENAME} from ${cwd}.`);
	}

	const rawConfig = JSON.parse(fs.readFileSync(resolvedPath, "utf8")) as {
		portless?: {
			name?: unknown;
		};
	};
	const name = rawConfig.portless?.name;

	if (typeof name !== "string" || !name.trim()) {
		throw new Error(`${DEV_CONFIG_FILENAME} must include portless.name.`);
	}

	return {
		root: path.dirname(resolvedPath),
		configPath: resolvedPath,
		name: name.trim(),
	};
}

function findDevConfig(cwd: string): string | undefined {
	let dir = path.resolve(cwd);

	for (;;) {
		const maybeConfig = path.join(dir, DEV_CONFIG_FILENAME);
		if (fs.existsSync(maybeConfig)) {
			return maybeConfig;
		}

		const parent = path.dirname(dir);
		if (parent === dir) {
			return undefined;
		}
		dir = parent;
	}
}
