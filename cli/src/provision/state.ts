// @cms-core/cli — state file do provisionamento (S4.1, §7.3).
//
// State file por cliente em `.factory-state/<slug>.json` (NUNCA commitado —
// coberto pelo .gitignore da raiz; o operador deve garantir `.factory-state/`
// ignorado). Fonte de idempotência e de `--resume`. Guarda REFERÊNCIAS
// (project-ref, zone id) mas NUNCA secrets em texto plano (§7.6).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { ProvisionState } from "./types.js";

/** Diretório default do state (relativo à raiz do monorepo). */
export const STATE_DIR = ".factory-state";

export function stateFilePath(repoRoot: string, slug: string): string {
  return resolve(repoRoot, STATE_DIR, `${slug}.json`);
}

/** Carrega o state existente ou cria um vazio. */
export function loadState(
  repoRoot: string,
  slug: string,
  databaseKind: "supabase" | "neon",
): ProvisionState {
  const path = stateFilePath(repoRoot, slug);
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as ProvisionState;
      // reconcilia o kind (o config manda) mas preserva os recursos existentes.
      return { ...parsed, slug, databaseKind };
    } catch {
      // state corrompido → recomeça limpo (mais seguro que abortar).
    }
  }
  return { slug, databaseKind, resources: {} };
}

/** Persiste o state (cria o diretório se preciso). NUNCA grava secrets. */
export function saveState(repoRoot: string, state: ProvisionState): void {
  const path = stateFilePath(repoRoot, state.slug);
  mkdirSync(dirname(path), { recursive: true });
  const withTs = { ...state, updatedAt: new Date().toISOString() };
  writeFileSync(path, `${JSON.stringify(withTs, null, 2)}\n`, "utf8");
}

/**
 * Assert de guarda (defesa em profundidade): o JSON serializado do state NÃO
 * pode conter nenhum dos valores de secret. Usado em teste e antes de gravar.
 * Retorna a lista de secrets que vazaram (vazia = ok).
 */
export function detectSecretLeak(
  state: ProvisionState,
  secretValues: string[],
): string[] {
  const serialized = JSON.stringify(state);
  return secretValues.filter((v) => v.length >= 6 && serialized.includes(v));
}
