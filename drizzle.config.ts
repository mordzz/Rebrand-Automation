import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// Used only by `npm run db:push` / `npm run db:studio`, run by hand against
// a deliberately chosen database. Never run by the build or at runtime.
export default defineConfig({
  schema: "./lib/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    // Schema administration wants a direct (non-pooled) connection.
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "",
  },
});
