import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR?.trim() || ".next",
  output: "standalone",
  serverExternalPackages: ["better-sqlite3"],
  transpilePackages: [
    "@factory/shared",
    "@factory/blueprints",
    "@factory/records",
    "@factory/production",
    "@factory/harness",
    "@factory/agent-runtime",
    "@factory/worker"
  ]
};

export default nextConfig;
