import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "unpdf"],
  // Keep repo AGENTS.md; do not let next dev rewrite it.
  agentRules: false,
};

export default nextConfig;
