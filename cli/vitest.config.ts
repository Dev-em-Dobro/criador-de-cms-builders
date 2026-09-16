import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)));
const core = resolve(root, "../packages/core/src");

export default defineConfig({
  resolve: {
    // `@cms-core/core` resolve pelo campo `exports` do package.json do core;
    // os aliases explícitos garantem a resolução dos subpaths nos testes do CLI
    // sem depender de symlink de workspace.
    alias: [
      { find: /^@cms-core\/core\/config$/, replacement: `${core}/config/index.ts` },
      { find: /^@cms-core\/core\/engine$/, replacement: `${core}/engine/index.ts` },
      { find: /^@cms-core\/core\/media$/, replacement: `${core}/media/index.ts` },
      { find: /^@cms-core\/core$/, replacement: `${core}/index.ts` },
      { find: /^@cms-core\/core\/(.*)$/, replacement: `${core}/$1` },
    ],
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
  },
});
