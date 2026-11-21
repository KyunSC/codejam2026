import type { NextConfig } from "next";
import { loadEnv } from "./scripts/load-env.mjs";

// Next loads Brim/.env itself; this adds the repo-root .env (skipped with BRIM_LOCAL_DB_ONLY=1).
// Variables already set (shell or Brim/.env) win.
loadEnv({ skipBrimEnv: true });

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
