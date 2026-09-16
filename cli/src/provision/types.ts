// @cms-core/cli — contratos do provisionamento (Fase 4, §7.3 / §7.5 / §13.3).
//
// O provisionamento é um orquestrador com state file, idempotência e rollback.
// Cada provider é um adapter com a MESMA interface `ProviderAdapter`:
//   ensure(ctx)   → idempotente: cria OU reconcilia se já existe
//   rollback(ctx) → desfaz SÓ o que ESTE adapter criou NESTA run
//
// A composição de adapters é dirigida por `database.kind` (D5):
//   supabase → [supabase(conteúdo+auth), bunny, resend, vercel]
//   neon     → [neon(conteúdo), supabase(auth-only), bunny, resend, vercel]

import type { ClientConfig } from "@cms-core/core/config";
import type { HttpClient } from "./http.js";
import type { SecretVault } from "./secrets.js";

/** Papel de um adapter de banco no caso 2-provedores (§13.3). */
export type SupabaseRole = "content-and-auth" | "auth-only";

/** Identidade de um adapter (= `id` na §7.3). */
export type AdapterId = "neon" | "supabase" | "bunny" | "resend" | "vercel";

/** Estado por recurso no state file (§7.3). Secrets NUNCA entram aqui. */
export type ResourceStatus = "pending" | "created" | "verified" | "failed";

export interface ResourceState {
  status: ResourceStatus;
  /** referência externa (project-ref, zone id) — nunca um secret. */
  externalId?: string;
  /** nome determinístico usado para a busca de idempotência. */
  name?: string;
  /** metadados não-secretos (branchId, pullZoneHostname, etc.). */
  meta?: Record<string, string>;
  /** true se ESTE run criou o recurso (governa o rollback). */
  createdThisRun?: boolean;
  createdAt?: string;
  error?: string;
}

/** State file por cliente (`.factory-state/<slug>.json`), nunca commitado. */
export interface ProvisionState {
  slug: string;
  databaseKind: "supabase" | "neon";
  /** um registro por adapter id (supabase pode ter papel content-and-auth|auth-only). */
  resources: Record<string, ResourceState>;
  updatedAt?: string;
}

/**
 * Envs coletadas ao longo do provisionamento (não-secretas + refs). As secretas
 * de verdade vão para o SecretVault, não para aqui — este mapa alimenta o
 * gen-env/Vercel com o que é seguro logar de forma redigida.
 */
export interface CollectedEnv {
  // Banco de conteúdo (secrets vão ao vault; aqui só refs não-secretas)
  supabaseProjectRef?: string;
  neonHost?: string;
  neonProjectId?: string;
  neonBranchId?: string;
  neonDbName?: string;
  neonUser?: string;
  // Auth (Supabase)
  supabaseUrl?: string;
  supabaseAuthProjectRef?: string;
  // Media
  bunnyCdnUrl?: string;
  bunnyStorageZoneId?: string;
  // Email
  resendDomainId?: string;
  resendDomainStatus?: string;
  // Hosting
  vercelProjectId?: string;
  vercelDeploymentUrl?: string;
}

/** Contexto passado a cada `ensure()`/`rollback()`. */
export interface ProvisionCtx {
  config: ClientConfig;
  /** HTTP injetável (fetch real em prod; fake nos testes). */
  http: HttpClient;
  /** tokens do operador (lidos de `.factory.env`). */
  tokens: OperatorTokens;
  /** cofre de secrets (CSPRNG + coletados dos providers). */
  vault: SecretVault;
  /** state file mutável (o adapter lê/grava seu próprio ResourceState). */
  state: ProvisionState;
  /** envs coletadas mutáveis (refs não-secretas). */
  env: CollectedEnv;
  /** true → plan-only: loga o que FARIA, zero chamadas HTTP. */
  dryRun: boolean;
  /** logger com redação de secrets. */
  log: ProvisionLogger;
  /** limite de polls (curto nos testes). */
  maxPolls?: number;
  /** intervalo entre polls em ms (0 nos testes p/ não esperar). */
  pollIntervalMs?: number;
  /** papel do adapter Supabase nesta composição (content-and-auth|auth-only). */
  supabaseRole?: SupabaseRole;
}

export interface ProviderAdapter {
  readonly id: AdapterId;
  /** nome-humano p/ logs/plano (ex.: "Supabase (auth-only)"). */
  readonly label: string;
  ensure(ctx: ProvisionCtx): Promise<void>;
  rollback(ctx: ProvisionCtx): Promise<void>;
}

/** Tokens do operador lidos de `.factory.env` (§7.4). */
export interface OperatorTokens {
  supabaseAccessToken?: string;
  supabaseOrgId?: string;
  neonApiKey?: string;
  neonOrgId?: string;
  neonProjectId?: string;
  bunnyAccountApiKey?: string;
  resendApiKey?: string;
  vercelToken?: string;
  vercelTeamId?: string;
}

/** Logger que redige valores de secrets antes de imprimir (§7.6). */
export interface ProvisionLogger {
  info(msg: string): void;
  warn(msg: string): void;
  /** registra um passo do plano (dry-run). */
  plan(msg: string): void;
  /** linhas emitidas (para asserts nos testes de que nada vazou). */
  readonly lines: string[];
}

/** Nome determinístico de um recurso por papel (§7.5 / §13.3). */
export function resourceName(slug: string, role: AdapterId | SupabaseRole): string {
  switch (role) {
    case "neon":
    case "content-and-auth":
      // No caso supabase single-provider o projeto de conteúdo+auth é `<slug>-cms`.
      // O recurso Neon de conteúdo é `<slug>-content`.
      return role === "neon" ? `${slug}-content` : `${slug}-cms`;
    case "auth-only":
      return `${slug}-auth`;
    case "supabase":
      return `${slug}-cms`;
    case "bunny":
      return `${slug}-media`;
    case "resend":
      return slug; // domínio vem do config; nome lógico é o slug
    case "vercel":
      return `${slug}-cms`;
    default:
      return `${slug}`;
  }
}
