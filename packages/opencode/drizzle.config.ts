import { defineConfig } from "drizzle-kit"

export default defineConfig({
  dialect: "turso",
  schema: "./src/**/*.sql.ts",
  out: "./migration",
  dbCredentials: {
    url: "file:./dev.db",
  },
})
