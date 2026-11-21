import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // dataset.ts reads these with fs at a path built from process.cwd(), which file tracing
  // cannot follow, so ship them with every server function. incoming_invoices/ is left out:
  // invoices arrive through the intake page.
  outputFileTracingIncludes: {
    "/**": ["./brim_ap_dataset/data/**/*", "./brim_ap_dataset/inbox/**/*"],
  },
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
