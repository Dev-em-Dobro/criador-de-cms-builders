// @cms-core/cli — utilitários compartilhados dos geradores de codegen.
//
// Regras de determinismo normativas (ADR-003 §7.3): header FIXO (sem data/hash),
// ordem de inserção preservada (NUNCA alfabetizar), sem timestamps voláteis.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Header fixo de arquivo gerado (ADR-003 §7.3 D4 — sem data/hash, senão todo run
 * produz diff no git). Os `*.generated.*` são commitados e o Vercel builda sem o
 * CLI (ADR-003 §4.3).
 */
export const GENERATED_HEADER =
  "// AUTO-GERADO por cms-core generate — não editar";

/** Serializa uma string como literal TS com aspas duplas (escapando aspas). */
export function tsString(value: string): string {
  return JSON.stringify(value);
}

/**
 * Escreve um arquivo gerado, criando os diretórios necessários. Garante uma
 * quebra de linha final (estilo do projeto).
 */
export function writeGenerated(absPath: string, content: string): void {
  mkdirSync(dirname(absPath), { recursive: true });
  const withNewline = content.endsWith("\n") ? content : `${content}\n`;
  writeFileSync(absPath, withNewline, "utf8");
}
