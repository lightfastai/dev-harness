import { appRuntimeIdentity } from "../lib/runtime-identity";
import { inngest } from "./client";

export const appPing = inngest.createFunction(
	{
		id: "app.ping",
		name: "App Ping",
		triggers: [{ event: "sandbox/app.ping" }],
	},
	async ({ step }) => {
		return step.run("resolve-runtime", () => ({
			app: appRuntimeIdentity.name,
			ok: true,
		}));
	},
);
