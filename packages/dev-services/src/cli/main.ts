import { handleDoctor } from "./commands/doctor.js";
import { handleIdentity } from "./commands/identity.js";
import { handleInngestSync } from "./commands/inngest-sync.js";
import {
	handlePostgresCreate,
	handlePostgresUp,
	handlePostgresUrl,
} from "./commands/postgres.js";
import {
	handleRedisPing,
	handleRedisUp,
	handleRedisUrl,
} from "./commands/redis.js";
import { handleSetup } from "./commands/setup.js";
import { printHelp } from "./help.js";

export async function main(args: string[] = process.argv.slice(2)): Promise<void> {
	const command = args.shift();

	try {
		switch (command) {
			case "setup":
				await handleSetup(args);
				break;
			case "doctor":
				await handleDoctor(args);
				break;
			case "identity":
				handleIdentity(args);
				break;
			case "inngest-sync":
				await handleInngestSync(args);
				break;
			case "postgres-url":
				handlePostgresUrl(args);
				break;
			case "postgres-up":
				await handlePostgresUp(args);
				break;
			case "postgres-create":
				await handlePostgresCreate(args);
				break;
			case "redis-url":
				handleRedisUrl(args);
				break;
			case "redis-up":
				await handleRedisUp(args);
				break;
			case "redis-ping":
				await handleRedisPing(args);
				break;
			case "-h":
			case "--help":
			case undefined:
				printHelp();
				process.exit(command ? 0 : 1);
				break;
			default:
				throw new Error(`Unknown command "${command}".`);
		}
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}
