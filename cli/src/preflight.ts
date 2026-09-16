// @cms-core/cli — preflight de tokens (S4.11, §7.4 / §7.5).
//
// Lê os tokens do operador de `./.factory.env` (nunca commitado) e valida a
// PRESENÇA dos que o(s) config(s) exigem. O token Neon (`NEON_API_KEY`) só é
// exigido se algum config usa `database=neon` (§7.4 nota Neon). A validação
// read-only por provider (uma chamada de confirmação) é feita pelo orquestrador
// ao criar cada adapter — aqui é a checagem barata de presença que roda ANTES.
//
// Fluxo 2-provedores: no caso neon, exige Supabase (auth-only) + Neon.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ClientConfig } from "@cms-core/core/config";
import type { OperatorTokens } from "./provision/types.js";

export const FACTORY_ENV = ".factory.env";

/** Parser mínimo de `.env` (KEY=VALUE, ignora comentários/linhas vazias). */
export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

/** Carrega `.factory.env` do repoRoot em um mapa de tokens (vazio se ausente). */
export function loadFactoryEnv(repoRoot: string): Record<string, string> {
  const path = resolve(repoRoot, FACTORY_ENV);
  if (!existsSync(path)) return {};
  return parseDotEnv(readFileSync(path, "utf8"));
}

/** Mapeia o dotenv para OperatorTokens (nomes de env → campos tipados). */
export function tokensFromEnv(env: Record<string, string>): OperatorTokens {
  return {
    supabaseAccessToken: env.SUPABASE_ACCESS_TOKEN,
    supabaseOrgId: env.SUPABASE_ORG_ID,
    neonApiKey: env.NEON_API_KEY,
    neonOrgId: env.NEON_ORG_ID,
    neonProjectId: env.NEON_PROJECT_ID,
    bunnyAccountApiKey: env.BUNNY_ACCOUNT_API_KEY,
    resendApiKey: env.RESEND_API_KEY,
    vercelToken: env.VERCEL_TOKEN,
    vercelTeamId: env.VERCEL_TEAM_ID,
  };
}

export interface PreflightResult {
  ok: boolean;
  /** nomes de env var ausentes. */
  missing: string[];
  /** se algum config usa Neon (⇒ NEON_API_KEY exigido). */
  needsNeon: boolean;
}

/**
 * Valida a presença dos tokens exigidos pelos configs dados. O token Neon só é
 * exigido se algum config selecionar `database=neon`. Sempre exige Supabase
 * (auth é sempre Supabase na v1), Bunny, Resend e Vercel.
 */
export function preflight(
  configs: ClientConfig[],
  tokens: OperatorTokens,
): PreflightResult {
  const needsNeon = configs.some((c) => c.providers.database.kind === "neon");
  const required: Array<[keyof OperatorTokens, string]> = [
    ["supabaseAccessToken", "SUPABASE_ACCESS_TOKEN"],
    ["supabaseOrgId", "SUPABASE_ORG_ID"],
    ["bunnyAccountApiKey", "BUNNY_ACCOUNT_API_KEY"],
    ["resendApiKey", "RESEND_API_KEY"],
    ["vercelToken", "VERCEL_TOKEN"],
  ];
  if (needsNeon) required.push(["neonApiKey", "NEON_API_KEY"]);

  const missing = required
    .filter(([field]) => {
      const v = tokens[field];
      return !v || String(v).trim() === "";
    })
    .map(([, envName]) => envName);

  return { ok: missing.length === 0, missing, needsNeon };
}
