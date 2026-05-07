import type { NextConfig } from "next";
import { withPortlessProxy } from "@lightfastai/dev-proxy/next";

const nextConfig: NextConfig = {};

export default withPortlessProxy(nextConfig);
