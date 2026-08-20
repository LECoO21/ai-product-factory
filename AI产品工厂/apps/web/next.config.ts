import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3"],
  transpilePackages: [
    "@factory/shared",
    "@factory/blueprints",
    "@factory/records",
    "@factory/production"
  ]
};

export default nextConfig;
