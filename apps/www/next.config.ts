import type { NextConfig } from "next";
import { withMicrofrontends } from "@vercel/microfrontends/next/config";
import { withPortlessMfeDev } from "@repo/portless-mfe-dev/next";

const nextConfig: NextConfig = {};

export default withPortlessMfeDev(withMicrofrontends(nextConfig));
