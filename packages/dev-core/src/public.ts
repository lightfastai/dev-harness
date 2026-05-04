import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export type DetectWorktreePrefix = (cwd?: string) => string | undefined;

export interface DevProjectConfig {
	root: string;
	configPath: string;
	name: string;
}

export interface ResolveDevProjectConfigOptions {
	cwd?: string;
	configPath?: string;
}

export interface WorktreeIdentity {
	name: string;
	baseName: string;
	worktreePrefix?: string;
}

export interface ResolveWorktreeRuntimeNameOptions {
	cwd?: string;
	detectWorktreePrefix?: DetectWorktreePrefix;
}

export interface ResolveWorktreeIdentityOptions extends ResolveWorktreeRuntimeNameOptions {
	baseName: string;
}

const RELATED_PROJECTS_CONFIG_FILENAME = "related-projects.json";

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

export function resolveWorktreeIdentity({
	baseName,
	cwd = process.cwd(),
	detectWorktreePrefix = defaultDetectWorktreePrefix,
}: ResolveWorktreeIdentityOptions): WorktreeIdentity {
	if (!baseName) {
		throw new Error("resolveWorktreeIdentity requires a base name.");
	}

	const detectedPrefix = detectWorktreePrefix(cwd);
	const worktreePrefix = detectedPrefix ? sanitizeWorktreePrefix(detectedPrefix) : undefined;

	return {
		name: worktreePrefix ? `${baseName}-${worktreePrefix}` : baseName,
		baseName,
		worktreePrefix,
	};
}

export function resolveWorktreeRuntimeName(
	baseName: string,
	options: ResolveWorktreeRuntimeNameOptions = {},
): string {
	return resolveWorktreeIdentity({ baseName, ...options }).name;
}

export function defaultDetectWorktreePrefix(cwd = process.cwd()): string | undefined {
	const cliPrefix = detectWorktreeViaGitCli(cwd);
	if (cliPrefix !== undefined) {
		return cliPrefix;
	}

	return detectWorktreeViaFilesystem(cwd);
}

export function branchToPrefix(branch?: string): string | undefined {
	if (!branch || branch === "HEAD" || branch === "main" || branch === "master") {
		return undefined;
	}

	const lastSegment = branch.split("/").pop() ?? "";
	const prefix = sanitizeWorktreePrefix(lastSegment);
	return prefix || undefined;
}

export function sanitizeWorktreePrefix(value: string): string {
	return value
		.split(".")
		.join("-")
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.replace(/--+/g, "-");
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

function detectWorktreeViaGitCli(cwd: string): string | undefined {
	const list = spawnSync("git", ["worktree", "list", "--porcelain"], {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	});

	if (list.status !== 0) {
		return undefined;
	}

	const worktreeCount = list.stdout
		.split("\n")
		.filter((line) => line.startsWith("worktree ")).length;
	if (worktreeCount <= 1) {
		return undefined;
	}

	const gitDir = spawnSync("git", ["rev-parse", "--git-dir"], {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	});
	const commonDir = spawnSync("git", ["rev-parse", "--git-common-dir"], {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	});
	const branch = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	});

	if (
		gitDir.status !== 0 ||
		commonDir.status !== 0 ||
		branch.status !== 0 ||
		path.resolve(cwd, gitDir.stdout.trim()) === path.resolve(cwd, commonDir.stdout.trim())
	) {
		return undefined;
	}

	return branchToPrefix(branch.stdout.trim());
}

function detectWorktreeViaFilesystem(startDir: string): string | undefined {
	let dir = startDir;

	for (;;) {
		const gitPath = path.join(dir, ".git");
		try {
			const stat = fs.statSync(gitPath);
			if (stat.isDirectory()) {
				return undefined;
			}
			if (stat.isFile()) {
				const content = fs.readFileSync(gitPath, "utf8").trim();
				const match = content.match(/^gitdir:\s*(.+)$/);
				if (!match) {
					return undefined;
				}
				const gitDir = path.resolve(dir, match[1]);
				if (!gitDir.match(/[/\\]worktrees[/\\][^/\\]+$/)) {
					return undefined;
				}
				return branchToPrefix(readBranchFromHead(gitDir) ?? "");
			}
		} catch {
			// Keep walking upward.
		}

		const parent = path.dirname(dir);
		if (parent === dir) {
			return undefined;
		}
		dir = parent;
	}
}

function readBranchFromHead(gitDir: string): string | undefined {
	try {
		const head = fs.readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
		const match = head.match(/^ref: refs\/heads\/(.+)$/);
		return match?.[1];
	} catch {
		return undefined;
	}
}
