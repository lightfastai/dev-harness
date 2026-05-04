import { resolveRelatedProjectUrl } from "@lightfastai/dev-proxy/related-projects";
import { withRelatedProject } from "@vercel/related-projects";

export const wwwUrl = withRelatedProject({
	projectName: "www",
	defaultHost: resolveRelatedProjectUrl("www"),
});
