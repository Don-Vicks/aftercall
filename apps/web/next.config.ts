import type { NextConfig } from "next";

const config: NextConfig = {
  // The shared core package ships TypeScript source.
  transpilePackages: ["@aftercall/core"],
};

export default config;
