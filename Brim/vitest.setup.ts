// Load Brim/.env into process.env for tests (Vitest does not do this itself), so db() sees
// DATABASE_URL. dotenv never overrides a variable that is already set, so the APP_TODAY pin in
// vitest.config.mts and a BRIM_LOCAL_DB_ONLY=1 set by the loop both win over .env.
import { config } from "dotenv";

config({ quiet: true });
