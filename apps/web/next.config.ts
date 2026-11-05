import type { NextConfig } from "next";

const config: NextConfig = {
  // The shared core package ships TypeScript source.
  transpilePackages: ["@aftercall/core"],
  // The browser demo (apps/desktop, pnpm build:demo) is published as static files in public/demo.
  async rewrites() {
    return [
      { source: "/demo", destination: "/demo/index.html" },
      { source: "/demo/", destination: "/demo/index.html" },
    ];
  },
};

export default config;
