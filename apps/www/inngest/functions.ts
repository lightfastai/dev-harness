import { wwwRuntimeIdentity } from "../lib/runtime-identity";
import { inngest } from "./client";

export const wwwPing = inngest.createFunction(
	{
		id: "www.ping",
		name: "WWW Ping",
		triggers: [{ event: "sandbox/www.ping" }],
	},
	async ({ step }) => {
		return step.run("resolve-runtime", () => ({
			app: wwwRuntimeIdentity.name,
			ok: true,
		}));
	},
);
