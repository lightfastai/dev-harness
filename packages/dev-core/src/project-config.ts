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

export const RELATED_PROJECTS_CONFIG_FILENAME = "related-projects.json";

export function resolveDevProjectConfig({
	cwd = process.cwd(),
	configPath,
}: ResolveDevProjectConfigOptions = {}): DevProjectConfig {
	const resolvedPath = configPath
		? path.resolve(cwd, configPath)
		: findRelatedProjectsConfig(cwd);

	if (!resolvedPath) {
		throw new Error(`Could not find ${RELATED_PROJECTS_CONFIG_FILENAME} from ${cwd}.`);
	}

	const rawConfig = JSON.parse(fs.readFileSync(resolvedPath, "utf8")) as {
		portless?: {
			name?: unknown;
		};
	};
	const name = rawConfig.portless?.name;

	if (typeof name !== "string" || !name.trim()) {
		throw new Error(`${RELATED_PROJECTS_CONFIG_FILENAME} must include portless.name.`);
	}

	return {
		root: path.dirname(resolvedPath),
		configPath: resolvedPath,
		name: name.trim(),
	};
}

function findRelatedProjectsConfig(cwd: string): string | undefined {
	let dir = path.resolve(cwd);

	for (;;) {
		const maybeConfig = path.join(dir, RELATED_PROJECTS_CONFIG_FILENAME);
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
