import { existsSync } from "fs";
import path from "path";
import express from "express";
import cookieParser from "cookie-parser";

const ROOT = path.resolve(import.meta.dirname, "../..");
const envFile = path.join(ROOT, ".env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const REQUIRED = ["DATABASE_URL", "SESSION_SECRET", "DATASET_DIR", "STORAGE_DIR", "AS_OF_DATE"];
const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing required settings: ${missing.join(", ")}. Copy .env.example to .env.local and fill them in.`);
  process.exit(1);
}
// Dataset and storage paths are relative to Brim/, whatever directory the server starts from.
for (const k of ["DATASET_DIR", "STORAGE_DIR"]) process.env[k] = path.resolve(ROOT, process.env[k]!);

// Loaded after the environment, since the database pool reads it when imported.
const { errors } = await import("./http");
const { session } = await import("./routes/session");
const { organizations, organization } = await import("./routes/organizations");
const { vendors } = await import("./routes/vendors");
const { invoices } = await import("./routes/invoices");
const { payments } = await import("./routes/payments");
const { audit } = await import("./routes/audit");

const app = express();
app.use(cookieParser());

const api = express.Router();
api.use(express.json({ limit: "5mb" }));
api.use(session);
api.use("/organizations", organizations);
for (const r of [organization, vendors, invoices, payments, audit]) api.use("/organizations/:orgId", r);
api.use((_req, res) => {
  res.status(404).json({ error: "No such endpoint" });
});
api.use(errors);
app.use("/api", api);

// The React app: served by Vite with hot reload in development, from the build in production.
if (process.env.NODE_ENV === "production") {
  const dist = path.join(ROOT, "dist");
  app.use(express.static(dist));
  app.get("/{*path}", (_req, res) => res.sendFile("index.html", { root: dist }));
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: "spa" });
  app.use(vite.middlewares);
}

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log(`http://localhost:${port}`));
