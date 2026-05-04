import { Inngest } from "inngest";
import { appRuntimeIdentity } from "../lib/runtime-identity";

export const inngest = new Inngest({
	id: appRuntimeIdentity.name,
	isDev: process.env.NODE_ENV === "development",
});
