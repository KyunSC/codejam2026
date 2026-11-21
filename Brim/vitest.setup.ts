// Load Brim/.env, then the repo-root .env, into process.env for tests (Vitest does not do this
// itself), so db() sees DATABASE_URL. The first file to set a variable wins, and dotenv never
// overrides a variable that is already set, so the APP_TODAY pin in vitest.config.mts and a
// BRIM_LOCAL_DB_ONLY=1 set by the loop both win over either file.
import { config } from "dotenv";

config({ path: [".env", "../.env"], quiet: true });
