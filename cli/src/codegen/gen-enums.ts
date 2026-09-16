// @cms-core/cli — gen-enums (S2.3, R2 parte 1).
//
// Lê `config.collections[].type` (na ORDEM do array) e emite
// `db/schema/enums.generated.ts` com `contentTypeEnum = pgEnum("content_type", [...])`
// — byte-idêntico ao `contentTypeEnum` hardcoded do gold (ADR-003 §3.1).
//
// Determinismo: a ordem = ordem do array `collections` (um `.map` é ordem-estável
// por definição). Zero Set/Object intermediário. Ref: ADR-003 §7.3 (D2).

import { resolve } from "node:path";
import type { ClientConfig } from "@cms-core/core/config";
import { GENERATED_HEADER, tsString, writeGenerated } from "./shared.js";

/**
 * Renderiza o conteúdo de `enums.generated.ts` a partir do config (função pura —
 * testável sem I/O).
 */
export function renderEnums(config: ClientConfig): string {
  const types = config.collections.map((c) => c.type);
  const items = types.map((t) => `  ${tsString(t)},`).join("\n");
  return `${GENERATED_HEADER}
import { pgEnum } from "drizzle-orm/pg-core";

/** All content types the CMS manages — derivado de client.config.ts (ordem canônica). */
export const contentTypeEnum = pgEnum("content_type", [
${items}
]);
`;
}

/** Gera `enums.generated.ts` no workspace-alvo. */
export function genEnums(config: ClientConfig, workspaceDir: string): string {
  const outPath = resolve(workspaceDir, "db/schema/enums.generated.ts");
  writeGenerated(outPath, renderEnums(config));
  return outPath;
}
