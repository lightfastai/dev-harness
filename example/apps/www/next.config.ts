import type { NextConfig } from "next";
import { withMicrofrontends } from "@vercel/microfrontends/next/config";
import { withPortlessProxy } from "@lightfastai/dev-proxy/next";

const nextConfig: NextConfig = {
	transpilePackages: ["@example/db-app", "@example/vendor-db"],
};

export default withPortlessProxy(withMicrofrontends(nextConfig));
