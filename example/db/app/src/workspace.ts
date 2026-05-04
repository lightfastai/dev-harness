import { existsSync } from "node:fs";
import path from "node:path";

export function resolveExampleWorkspaceRoot(startDir = process.cwd()): string {
	let dir = path.resolve(startDir);

	for (;;) {
		if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
			return dir;
		}

		const parent = path.dirname(dir);
		if (parent === dir) {
			throw new Error(`Unable to find workspace root from ${startDir}`);
		}
		dir = parent;
	}
}
