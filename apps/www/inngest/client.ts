import { Inngest } from "inngest";

import { wwwRuntimeIdentity } from "../lib/runtime-identity";

export const inngest = new Inngest({
	id: wwwRuntimeIdentity.name,
	isDev: process.env.NODE_ENV === "development",
});
