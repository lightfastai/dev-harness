import type { NextConfig } from "next";
import { withMicrofrontends } from "@vercel/microfrontends/next/config";
import { withPortlessMfeDev } from "@lightfastai/related-projects/next";

const nextConfig: NextConfig = {
	transpilePackages: ["@example/db-app", "@example/vendor-db"],
};

export default withPortlessMfeDev(withMicrofrontends(nextConfig));
