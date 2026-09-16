import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@cms-core/core/config": fileURLToPath(
        new URL("./src/config/index.ts", import.meta.url),
      ),
      "@cms-core/core": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
