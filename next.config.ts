import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  cacheComponents: true,
  // DB-backed routes use dynamic data; partial prefetch avoids dev console errors
  // from <Link prefetch={true}> (instant-link-prefetch-partial).
  partialPrefetching: true,
};

export default nextConfig;
