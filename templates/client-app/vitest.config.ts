import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvConfig } from "@next/env";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)));

// Load env in TEST mode: @next/env reads `.env.test.local` / `.env.test`
// and deliberately ignores `.env.local`. That asymmetry is the safety line —
// integration tests must never inherit the shared/production Supabase
// project from dev config, because they consume its quotas (MFA verifies:
// 15/hour per IP; built-in SMTP: 2 emails/hour project-wide) and create
// users in it. Point tests at a dedicated project via `.env.test.local`
// (see `.env.test.example`); without it, integration suites skip.
{
  const env = process.env as Record<string, string | undefined>;
  env.NODE_ENV ??= "test";
  loadEnvConfig(root);
}

export default defineConfig({
  resolve: {
    alias: [
      // `@cms-core/core` (nome de pacote válido, ADR-001 Decisão 2) resolve
      // NATIVAMENTE pelo campo `exports` do package.json do core — sem alias.
      // Só mantemos o alias "@/..." e os shims de contexto de servidor.
      // Alias only "@/..." so package imports like "@supabase/ssr" are untouched.
      { find: /^@\//, replacement: `${root}/` },
      /**
       * Server-context shims. Route handlers and guards import `next/headers`
       * and `server-only`, which only work inside a Next.js request scope.
       * The stub gives tests a controllable cookie jar standing in for the
       * request's cookies — see tests/helpers/next-headers-stub.ts.
       */
      {
        find: /^next\/headers$/,
        replacement: `${root}/tests/helpers/next-headers-stub.ts`,
      },
      {
        find: /^server-only$/,
        replacement: `${root}/tests/helpers/server-only-stub.ts`,
      },
    ],
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    /**
     * Sequential on purpose. The auth suites share three global resources:
     * the per-IP Supabase MFA verify budget (15/hour), the active-admin count
     * that the last-admin safeguard reads, and per-file cookie-jar state.
     * Parallel files turn all three into races.
     */
    fileParallelism: false,
    // Auth integration tests talk to the real Supabase project and sometimes
    // wait out a 30s TOTP window to avoid reusing a code.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
