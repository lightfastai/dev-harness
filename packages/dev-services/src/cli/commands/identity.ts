import { resolveWorktreeIdentity } from "@lightfastai/dev-core";
import { parseOptions } from "../args.js";

export function handleIdentity(args: string[]): void {
	const { options } = parseOptions(args);
	if (!options.appName) {
		throw new Error("lightfast-dev-services identity requires --app-name <name>.");
	}

	const identity = resolveWorktreeIdentity({
		baseName: options.appName,
		cwd: process.cwd(),
	});

	if (options.json) {
		console.log(JSON.stringify(identity));
		return;
	}

	console.log(identity.name);
}
