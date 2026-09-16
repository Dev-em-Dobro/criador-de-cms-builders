#!/usr/bin/env -S npx tsx
// @cms-core/cli — bin da `cms-factory` (S3.1). Entrada fina: delega ao router
// em `src/cli.ts`. Executado via tsx na Fase 3 (sem build step do CLI).

import { run } from "../src/cli.js";

run(process.argv.slice(2)).then((code) => process.exit(code));
