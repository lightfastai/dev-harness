import { resolveRelatedProjectUrl } from "@lightfastai/dev-proxy/related-projects";
import { withRelatedProject } from "@vercel/related-projects";

export const appUrl = withRelatedProject({
	projectName: "app",
	defaultHost: resolveRelatedProjectUrl("app"),
});
