// @cms-core/cli — gen-zod (S2.6, R4 / completa gen-zod de §6.2).
//
// Emite `lib/content/schemas.generated.ts` com os schemas Zod por tipo. Conforme
// ADR-003 §3.5 / regra de determinismo D3: o gerado NÃO reconstrói `z.object(...)`
// textualmente — importa o config e chama `buildZodSchemas(config)` em RUNTIME.
// Isso torna a byte-identidade automática (o schema É o output do builder que o
// TEST-001 já prova byte-idêntico aos 9 schemas gold). `buildZodSchemas` filtra
// campos `uiHidden` (ADR-003 §3.6) — o `industryFacets` sintético NÃO entra.
//
// Determinismo: o arquivo é fixo (só muda o nome do export do config); zero
// serialização volátil.

import { resolve } from "node:path";
import type { ClientConfig } from "@cms-core/core/config";
import { GENERATED_HEADER, writeGenerated } from "./shared.js";

/** Renderiza o conteúdo de `schemas.generated.ts` (função pura — testável). */
export function renderZod(configExportName: string): string {
  const importClause =
    configExportName === "default"
      ? `import clientConfig from "@/client.config";`
      : `import { ${configExportName} as clientConfig } from "@/client.config";`;

  return `${GENERATED_HEADER}
// Schemas Zod por tipo derivados de client.config.ts (S2.6, gen-zod).
//
// D3 (ADR-003 §3.5): chama buildZodSchemas(config) em RUNTIME em vez de
// reconstruir z.object(...) textualmente — byte-identidade automática com os 9
// schemas gold (TEST-001). buildZodSchemas filtra campos uiHidden.

import type { ZodTypeAny } from "zod";
import { buildZodSchemas } from "@cms-core/core/config";
${importClause}

/** Schemas Zod por content type (mesma referência que o motor usa nos behaviors). */
export const schemas: Record<string, ZodTypeAny> = buildZodSchemas(clientConfig);
`;
}

/** Gera `lib/content/schemas.generated.ts` no workspace-alvo. */
export function genZod(
  _config: ClientConfig,
  workspaceDir: string,
  configExportName: string,
): string {
  const outPath = resolve(workspaceDir, "lib/content/schemas.generated.ts");
  writeGenerated(outPath, renderZod(configExportName));
  return outPath;
}
