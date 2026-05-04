import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
	branchToPrefix,
	defaultDetectWorktreePrefix,
	resolveWorktreeIdentity,
	resolveWorktreeRuntimeName,
	sanitizeWorktreePrefix,
} from "../src/public.js";

test("resolveWorktreeRuntimeName derives names from detected prefixes", () => {
	const main = resolveWorktreeIdentity({
		baseName: "lightfast-app",
		detectWorktreePrefix: () => undefined,
	});
	const linked = resolveWorktreeIdentity({
		baseName: "lightfast-app",
		detectWorktreePrefix: () => "Feature/Inngest UI!",
	});

	assert.equal(main.name, "lightfast-app");
	assert.equal(main.baseName, "lightfast-app");
	assert.equal(main.worktreePrefix, undefined);
	assert.equal(linked.name, "lightfast-app-feature-inngest-ui");
	assert.equal(linked.baseName, "lightfast-app");
	assert.equal(linked.worktreePrefix, "feature-inngest-ui");
	assert.equal(
		resolveWorktreeRuntimeName("lightfast-platform", {
			detectWorktreePrefix: () => "fix-ui",
		}),
		"lightfast-platform-fix-ui",
	);
});

test("worktree prefixes sanitize branch names consistently", () => {
	assert.equal(branchToPrefix("feature/platform-shell"), "platform-shell");
	assert.equal(branchToPrefix("feature/Inngest UI!"), "inngest-ui");
	assert.equal(branchToPrefix("main"), undefined);
	assert.equal(branchToPrefix("master"), undefined);
	assert.equal(branchToPrefix("HEAD"), undefined);
	assert.equal(sanitizeWorktreePrefix("feature.fix_ui"), "feature-fix-ui");
});

test("defaultDetectWorktreePrefix falls back to git worktree file detection", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "dev-core-worktree-"));
	const nested = path.join(root, "apps", "app");
	const gitDir = path.join(root, ".git-common", "worktrees", "feature-worktree-core");
	fs.mkdirSync(nested, { recursive: true });
	fs.mkdirSync(gitDir, { recursive: true });
	fs.writeFileSync(path.join(root, ".git"), `gitdir: ${gitDir}\n`);
	fs.writeFileSync(path.join(gitDir, "HEAD"), "ref: refs/heads/feature/worktree-core\n");

	assert.equal(defaultDetectWorktreePrefix(nested), "worktree-core");
});

test("package export map supports intended ESM imports", () => {
	const result = spawnSync(
		process.execPath,
		[
			"--input-type=module",
			"--eval",
			`
				const api = await import("@lightfastai/dev-core");
				if (typeof api.resolveWorktreeRuntimeName !== "function") throw new Error("missing identity API");
				if (typeof api.defaultDetectWorktreePrefix !== "function") throw new Error("missing detection API");
			`,
		],
		{
			cwd: process.cwd(),
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		},
	);

	assert.equal(result.status, 0, result.stderr || result.stdout);
});
