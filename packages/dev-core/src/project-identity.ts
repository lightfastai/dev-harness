import { createHash } from "node:crypto";
import path from "node:path";
import {
	resolveDevProjectConfig,
	type DevProjectConfig,
	type ResolveDevProjectConfigOptions,
} from "./project-config.js";
import {
	resolveWorktreeIdentity,
	type DetectWorktreePrefix,
} from "./worktree.js";

export type Env = Record<string, string | undefined>;

export interface DevProjectIdentity extends DevProjectConfig {
	worktreePrefix?: string;
	rootHash: string;
}

export interface ResolveDevProjectIdentityOptions extends ResolveDevProjectConfigOptions {
	env?: Env;
	detectWorktreePrefix?: DetectWorktreePrefix;
}

export function resolveDevProjectIdentity({
	cwd = process.cwd(),
	configPath,
	detectWorktreePrefix,
}: ResolveDevProjectIdentityOptions = {}): DevProjectIdentity {
	const project = resolveDevProjectConfig({ cwd, configPath });
	const identity = resolveWorktreeIdentity({
		baseName: project.name,
		cwd: project.root,
		detectWorktreePrefix,
	});

	return {
		...project,
		worktreePrefix: identity.worktreePrefix,
		rootHash: hashProjectRoot(project.root),
	};
}

export function hashProjectRoot(root: string): string {
	return createHash("sha1")
		.update(path.resolve(root))
		.digest("hex")
		.slice(0, 8);
}
