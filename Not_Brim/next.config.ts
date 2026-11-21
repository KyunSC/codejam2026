import type { NextConfig } from "next";

// cacheComponents is off on purpose: with it on, Next 16 rejects the
// `runtime` and `dynamic` route segment exports that the spec requires.
const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
