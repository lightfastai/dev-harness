import { resolveProjectUrl, withProject } from "@lightfastai/dev-proxy/projects";

export const wwwUrl = withProject({
	projectName: "www",
	defaultHost: resolveProjectUrl("www"),
});
