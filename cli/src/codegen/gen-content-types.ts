// @cms-core/cli — gen-content-types (S2.3, R2 parte 1).
//
// Lê `config.collections` e emite `lib/content/content-types.generated.ts` com
// `CONTENT_TYPES as const`, `type ContentType`, `SINGLETON_PAGES`,
// `SEGMENT_TO_TYPE` — derivados via os builders de @cms-core/core/config
// (`buildContentTypes`/`buildSingletonPages`/`buildSegmentToType`), que o
// TEST-001 já prova iguais aos literais gold. Ref: ADR-003 §3.2.
//
// Determinismo (ADR-003 §7.3 D1): as chaves de SEGMENT_TO_TYPE/SINGLETON_PAGES
// são emitidas na ORDEM DE INSERÇÃO dos builders (ordem do array `collections` /
// dos `singletonRoutes`), NUNCA alfabetizadas.

import { resolve } from "node:path";
import type { ClientConfig } from "@cms-core/core/config";
import {
  buildContentTypes,
  buildSingletonPages,
  buildSegmentToType,
} from "@cms-core/core/config";
import { GENERATED_HEADER, tsString, writeGenerated } from "./shared.js";

/**
 * Renderiza o conteúdo de `content-types.generated.ts` (função pura — testável).
 */
export function renderContentTypes(config: ClientConfig): string {
  const contentTypes = buildContentTypes(config);
  const segmentToType = buildSegmentToType(config);
  const singletonPages = buildSingletonPages(config);

  const typesLiteral = contentTypes.map((t) => `  ${tsString(t)},`).join("\n");

  // Ordem de inserção preservada (Object.entries reflete a ordem de criação nos
  // builders, que iteram o array `collections`).
  const segLines = Object.entries(segmentToType)
    .map(([seg, type]) => `  ${tsString(seg)}: ${tsString(type)},`)
    .join("\n");

  const pageLines = Object.entries(singletonPages)
    .map(
      ([key, { type, slug }]) =>
        `  ${tsString(key)}: { type: ${tsString(type)}, slug: ${tsString(slug)} },`,
    )
    .join("\n");

  return `${GENERATED_HEADER}
// Content types, roteamento e singletons derivados de client.config.ts.

export const CONTENT_TYPES = [
${typesLiteral}
] as const;

export type ContentType = (typeof CONTENT_TYPES)[number];

/** Segmento plural (URL do admin) → content type. */
export const SEGMENT_TO_TYPE: Record<string, ContentType> = {
${segLines}
};

/** Chave lógica de rota → { type, slug } (singletons). */
export const SINGLETON_PAGES: Record<
  string,
  { type: ContentType; slug: string }
> = {
${pageLines}
};
`;
}

/** Gera `content-types.generated.ts` no workspace-alvo. */
export function genContentTypes(
  config: ClientConfig,
  workspaceDir: string,
): string {
  const outPath = resolve(
    workspaceDir,
    "lib/content/content-types.generated.ts",
  );
  writeGenerated(outPath, renderContentTypes(config));
  return outPath;
}
