import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  // AGENTS.md holds the owner's instructions; `next dev` otherwise appends its own
  // vendor block to it on every run and dirties the working tree.
  agentRules: false,
};
export default nextConfig;
