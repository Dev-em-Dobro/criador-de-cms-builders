import { defineConfig } from "@playwright/test";

/**
 * E2E config. Point E2E_BASE_URL at a running CMS (with a seeded admin + DB) to
 * run: `E2E_BASE_URL=http://localhost:3010 npm run test:e2e`.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3010",
    trace: "on-first-retry",
  },
});
