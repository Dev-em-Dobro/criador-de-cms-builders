#!/usr/bin/env -S npx tsx
// @cms-core/cli — entrypoint `cms-core generate --config <path>` (S2.3, ADR-003 §5.2).
//
// Carrega o `client.config.ts` do workspace-alvo, valida-o com
// `validateClientConfig`, resolve o diretório do workspace (o dir do config) e
// roda os geradores de codegen na ordem do pipeline (ADR-003 §4.1).
//
// Na Fase 2 é executado via `tsx` (sem build step do CLI). O `.ts` do config é
// carregado por import dinâmico (tsx resolve TS + os aliases de workspace).

import { resolve, dirname, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { validateClientConfig } from "@cms-core/core/config";
import type { ClientConfig } from "@cms-core/core/config";
import { runCodegen } from "./index.js";

function parseArgs(argv: string[]): { config: string } {
  let config: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--config") {
      config = argv[i + 1];
      i++;
    } else if (arg.startsWith("--config=")) {
      config = arg.slice("--config=".length);
    }
  }
  if (!config) {
    throw new Error(
      "cms-core generate: faltou --config <path> (ex.: --config ./client.config.ts)",
    );
  }
  return { config };
}

/**
 * Extrai o `ClientConfig` de um módulo de config carregado + o NOME do export.
 * O nome é usado pelos geradores que fazem runtime-call (gen-zod/gen-ui-fields)
 * para emitir `import { <name> as clientConfig } from "@/client.config"`.
 * Aceita `default`, um export nomeado `config`, ou o primeiro export objeto.
 */
function pickConfig(mod: Record<string, unknown>): {
  value: unknown;
  exportName: string;
} {
  if (mod.default !== undefined) return { value: mod.default, exportName: "default" };
  if (mod.config !== undefined) return { value: mod.config, exportName: "config" };
  // primeiro export que seja um objeto (ex.: demoCorpConfig).
  for (const [name, value] of Object.entries(mod)) {
    if (value && typeof value === "object") return { value, exportName: name };
  }
  throw new Error("cms-core generate: nenhum export de config encontrado no arquivo.");
}

export async function main(argv: string[]): Promise<void> {
  const { config: configArg } = parseArgs(argv);
  const configPath = isAbsolute(configArg)
    ? configArg
    : resolve(process.cwd(), configArg);
  const workspaceDir = dirname(configPath);

  const mod = (await import(pathToFileURL(configPath).href)) as Record<
    string,
    unknown
  >;
  const { value: raw, exportName } = pickConfig(mod);
  const config: ClientConfig = validateClientConfig(raw);

  const { written } = runCodegen(config, workspaceDir, { configExportName: exportName });
  for (const f of written) {
    console.log(`  gerado: ${f}`);
  }
  console.log(`cms-core generate: ${written.length} arquivo(s) gerado(s).`);
}

// Executa quando chamado diretamente (não quando importado por testes).
const invokedDirectly =
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
