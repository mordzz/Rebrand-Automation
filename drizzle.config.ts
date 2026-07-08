import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Use the DIRECT (non-pooled, port 5432) Supabase URL for migrations.
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "",
  },
});
