import { resolveProjectUrl, withProject } from "@lightfastai/dev-proxy/projects";

export const appUrl = withProject({
	projectName: "app",
	defaultHost: resolveProjectUrl("app"),
});
