import { resolveRelatedProjectUrl } from "@lightfastai/related-projects/related-projects";
import { withRelatedProject } from "@vercel/related-projects";

export const appUrl = withRelatedProject({
	projectName: "app",
	defaultHost: resolveRelatedProjectUrl("app"),
});
