import type { NextConfig } from "next";

// The UI is the prototype's plain HTML/CSS/JS in public/. The site root serves it.
const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: "/", destination: "/index.html" }];
  },
};

export default nextConfig;
