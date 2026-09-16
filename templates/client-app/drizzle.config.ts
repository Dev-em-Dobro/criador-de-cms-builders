import type { Config } from "drizzle-kit";

// drizzle-kit doesn't load .env.local the way Next does.
try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local — rely on the shell environment
}

/**
 * Migrations push DDL and the database password over the same connection, so
 * it must not travel in clear text. TLS goes in through the URL (`sslmode`)
 * rather than a driver option because drizzle-kit — not our code — opens this
 * connection. Same reason as `ssl: "require"` in db/index.ts.
 */
function withTls(url: string): string {
  if (!url || /[?&]sslmode=/.test(url)) return url;
  return url + (url.includes("?") ? "&" : "?") + "sslmode=require";
}

export default {
  schema: "./db/schema/index.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    // Port 5432, not the pooled 6543: DDL through transaction-mode pooling is
    // unreliable, and migrations want a session-scoped connection.
    url: withTls(process.env.DIRECT_URL ?? ""),
  },
  // Never introspect or emit DDL for `auth` — it is Supabase-owned and any
  // generated `CREATE SCHEMA "auth"` would fail. auth.users is referenced via
  // `authUsers` from drizzle-orm/supabase instead.
  schemaFilter: ["public"],
  // Leave Supabase's built-in roles alone rather than trying to drop them.
  entities: { roles: { provider: "supabase" } },
  strict: true,
} satisfies Config;
