import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Set the correct workspace root to avoid lockfile warnings
  outputFileTracingRoot: require('path').join(__dirname, '../'),

  // External packages for server components
  serverExternalPackages: ['@supabase/supabase-js'],
};

export default nextConfig;
