// @cms-core/cli — gen-ui-fields (S2.6, R4 / completa gen-ui-fields de §6.2).
//
// Emite `lib/content/ui-fields.generated.ts` com o mapa `FIELDS` e a função
// `emptyData` derivados de `config.collections[].fields`. Como os schemas Zod,
// usa RUNTIME-CALL aos builders (`buildFields`/`buildEmptyData`) — byte-identidade
// automática com o `FIELDS`/`emptyData` gold (TEST-001). Os builders FILTRAM
// campos `uiHidden` (ADR-003 §3.6 P3): o `industryFacets` sintético NÃO entra no
// FIELDS gerado (o `FIELDS["case"]` gold tem 10 campos, não 11).
//
// Determinismo: arquivo fixo (só o nome do export do config varia).

import { resolve } from "node:path";
import type { ClientConfig } from "@cms-core/core/config";
import { GENERATED_HEADER, writeGenerated } from "./shared.js";

/** Renderiza o conteúdo de `ui-fields.generated.ts` (função pura — testável). */
export function renderUiFields(configExportName: string): string {
  const importClause =
    configExportName === "default"
      ? `import clientConfig from "@/client.config";`
      : `import { ${configExportName} as clientConfig } from "@/client.config";`;

  return `${GENERATED_HEADER}
// FIELDS + emptyData derivados de client.config.ts (S2.6, gen-ui-fields).
//
// Runtime-call aos builders (byte-identidade automática, TEST-001). buildFields e
// buildEmptyData filtram campos uiHidden (ADR-003 §3.6 P3): o industryFacets
// sintético NÃO entra no FIELDS (o gold tem 10 campos em \`case\`, não 11).

import { buildFields, buildEmptyData, type FieldSpec } from "@cms-core/core/config";
${importClause}

/** FieldSpec[] por content type (UI do admin) — byte-idêntico ao gold. */
export const FIELDS: Record<string, FieldSpec[]> = buildFields(clientConfig);

/** Valores iniciais por kind para uma nova entry do tipo dado. */
export function emptyData(type: string): Record<string, unknown> {
  return buildEmptyData(clientConfig, type);
}
`;
}

/** Gera `lib/content/ui-fields.generated.ts` no workspace-alvo. */
export function genUiFields(
  _config: ClientConfig,
  workspaceDir: string,
  configExportName: string,
): string {
  const outPath = resolve(workspaceDir, "lib/content/ui-fields.generated.ts");
  writeGenerated(outPath, renderUiFields(configExportName));
  return outPath;
}
