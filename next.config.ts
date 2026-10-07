import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Google Cloud Vision (loaded via dynamic import in the server-only
  // vision provider) must not be webpack-bundled: google-gax reads its own
  // package.json at runtime, which bundling breaks ("Module not found:
  // Can't resolve '../../package.json'"). Externalized packages load via
  // Node require() instead, where that resolution works.
  serverExternalPackages: ["@google-cloud/vision", "google-gax"],
};

export default nextConfig;
