import { resolveRelatedProjectUrl } from "@lightfastai/related-projects/related-projects";
import { withRelatedProject } from "@vercel/related-projects";

export const wwwUrl = withRelatedProject({
	projectName: "www",
	defaultHost: resolveRelatedProjectUrl("www"),
});
