import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The demo reset reads the dataset CSVs at runtime, so ship them with that route.
  outputFileTracingIncludes: {
    "/api/admin/reset": ["./data/*.csv"],
  },
};

export default nextConfig;
