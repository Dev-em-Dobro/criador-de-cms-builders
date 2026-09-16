// @cms-core/cli — orquestrador de provisionamento (S4.1 + S4.7, §7.3 / §7.5 / §13.3).
//
// Motor com state file, idempotência, `--resume`, `--dry-run` e rollback em
// ordem inversa. Compõe a lista de adapters por `database.kind` (D5):
//   supabase → [supabase(conteúdo+auth), bunny, resend, vercel]
//   neon     → [neon(conteúdo), supabase(auth-only), bunny, resend, vercel]
//
// Ordem de rollback = inversa da composição (§7.5):
//   supabase → Vercel→Resend→Bunny→Supabase
//   neon     → Vercel→Resend→Bunny→Supabase(auth-only)→Neon
//
// Falha parcial: se um adapter falha "duro", os adapters ANTERIORES executam
// rollback() na ordem inversa, removendo só o que ESTA run criou. O rollback é
// best-effort e logado; órfãos que ele não apagar são LISTADOS explicitamente.

import type { ClientConfig } from "@cms-core/core/config";
import type {
  ProviderAdapter,
  ProvisionCtx,
  OperatorTokens,
  ProvisionState,
  CollectedEnv,
  SupabaseRole,
} from "./types.js";
import type { HttpClient } from "./http.js";
import { FetchHttpClient } from "./http.js";
import { SecretVault, generatePassword } from "./secrets.js";
import { createLogger } from "./logger.js";
import { loadState, saveState, detectSecretLeak, stateFilePath } from "./state.js";
import { createSupabaseAdapter } from "./supabase.js";
import { createNeonAdapter } from "./neon.js";
import { createBunnyAdapter } from "./bunny.js";
import { createResendAdapter } from "./resend.js";
import { createVercelAdapter } from "./vercel.js";

export interface OrchestratorOptions {
  config: ClientConfig;
  repoRoot: string;
  tokens: OperatorTokens;
  /** HTTP injetável — FetchHttpClient em prod; FakeHttpClient nos testes. */
  http?: HttpClient;
  dryRun?: boolean;
  resume?: boolean;
  /** não escreve no console (testes). */
  quiet?: boolean;
  /** limites de poll (curtos nos testes). */
  maxPolls?: number;
  pollIntervalMs?: number;
  /** vault pré-populado (testes) — default cria vazio. */
  vault?: SecretVault;
}

export interface ProvisionOutcome {
  ok: boolean;
  state: ProvisionState;
  env: CollectedEnv;
  /** ordem de composição dos adapters (para asserts/plano). */
  composition: string[];
  /** recursos órfãos que o rollback não conseguiu remover. */
  orphans: string[];
  /** senha temporária do admin — impressa UMA vez no handoff (§7.6). */
  adminPassword?: string;
  /** logs redigidos emitidos. */
  logs: string[];
  /** stateKey do adapter que falhou (se houve). */
  failedAt?: string;
}

/**
 * Compõe a lista de adapters por `database.kind` (D5). Cada entrada carrega o
 * `stateKey` (papel) para idempotência e um label estável para o plano.
 */
export function composeAdapters(config: ClientConfig): Array<{
  adapter: ProviderAdapter;
  stateKey: string;
  supabaseRole?: SupabaseRole;
}> {
  const kind = config.providers.database.kind;
  if (kind === "neon") {
    return [
      { adapter: createNeonAdapter(), stateKey: "neon" },
      { adapter: createSupabaseAdapter("auth-only"), stateKey: "supabase-auth", supabaseRole: "auth-only" },
      { adapter: createBunnyAdapter(), stateKey: "bunny" },
      { adapter: createResendAdapter(), stateKey: "resend" },
      { adapter: createVercelAdapter(), stateKey: "vercel" },
    ];
  }
  return [
    { adapter: createSupabaseAdapter("content-and-auth"), stateKey: "supabase", supabaseRole: "content-and-auth" },
    { adapter: createBunnyAdapter(), stateKey: "bunny" },
    { adapter: createResendAdapter(), stateKey: "resend" },
    { adapter: createVercelAdapter(), stateKey: "vercel" },
  ];
}

export async function provision(opts: OrchestratorOptions): Promise<ProvisionOutcome> {
  const { config, repoRoot, tokens } = opts;
  const dryRun = opts.dryRun ?? false;
  const resume = opts.resume ?? false;
  const kind = config.providers.database.kind;

  const vault = opts.vault ?? new SecretVault();
  const log = createLogger(vault, { toConsole: !opts.quiet, prefix: dryRun ? "[dry-run] " : "" });
  const http = opts.http ?? new FetchHttpClient();
  const state = loadState(repoRoot, config.slug, kind);
  const env: CollectedEnv = {};

  const steps = composeAdapters(config);
  const composition = steps.map((s) => s.adapter.label);

  const outcome: ProvisionOutcome = {
    ok: false,
    state,
    env,
    composition,
    orphans: [],
    logs: log.lines,
  };

  if (dryRun) {
    log.info(`Plano de provisionamento (${kind}) — slug="${config.slug}":`);
    log.info(`  composição: ${composition.join(" → ")}`);
  } else {
    log.info(`Provisionando "${config.slug}" (${kind}): ${composition.join(" → ")}`);
  }

  // executados (na ordem) — para rollback inverso em caso de falha.
  const executed: typeof steps = [];

  for (const step of steps) {
    const { adapter, stateKey, supabaseRole } = step;
    const existing = state.resources[stateKey];
    // --resume: pula tudo já `verified`.
    if (resume && existing?.status === "verified") {
      log.info(`${adapter.label}: já verificado — pulado (--resume).`);
      executed.push(step);
      continue;
    }

    const ctx: ProvisionCtx = {
      config,
      http,
      tokens,
      vault,
      state,
      env,
      dryRun,
      log,
      maxPolls: opts.maxPolls,
      pollIntervalMs: opts.pollIntervalMs,
      supabaseRole,
    };

    try {
      await adapter.ensure(ctx);
      executed.push(step);
      if (!dryRun) saveState(repoRoot, state);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`${adapter.label}: FALHA — ${msg}`);
      if (state.resources[stateKey]) {
        state.resources[stateKey].status = "failed";
        state.resources[stateKey].error = msg;
      } else {
        state.resources[stateKey] = { status: "failed", error: msg };
      }
      outcome.failedAt = stateKey;
      if (!dryRun) saveState(repoRoot, state);

      // rollback dos executados em ordem INVERSA (§7.5).
      log.warn(`Rollback (ordem inversa) de ${executed.length} recurso(s) criado(s) nesta run…`);
      for (let i = executed.length - 1; i >= 0; i--) {
        const done = executed[i];
        const rollbackCtx: ProvisionCtx = {
          ...ctx,
          supabaseRole: done.supabaseRole,
        };
        try {
          await done.adapter.rollback(rollbackCtx);
          if (!dryRun) saveState(repoRoot, state);
        } catch (rbErr) {
          const rbMsg = rbErr instanceof Error ? rbErr.message : String(rbErr);
          const ref = state.resources[done.stateKey]?.externalId ?? "(sem ref)";
          const orphan = `${done.adapter.label} ${ref}: ${rbMsg}`;
          outcome.orphans.push(orphan);
          log.warn(`ÓRFÃO (rollback falhou): ${orphan} — limpar à mão.`);
        }
      }
      // consolida órfãos que os adapters marcaram como não-removíveis.
      finalizeOutcome(outcome, vault, state, kind);
      return outcome;
    }
  }

  // sucesso: gera a senha temporária do admin (impressa uma vez).
  if (!dryRun) {
    const adminPassword = generatePassword();
    vault.set("seedAdminPassword", adminPassword);
    outcome.adminPassword = adminPassword;
  }
  outcome.ok = true;
  if (!dryRun) saveState(repoRoot, state);

  finalizeOutcome(outcome, vault, state, kind, opts.quiet);
  return outcome;
}

/** Guarda de segurança (§7.6): assegura que nenhum secret vazou para o state. */
function finalizeOutcome(
  outcome: ProvisionOutcome,
  vault: SecretVault,
  state: ProvisionState,
  kind: string,
  quiet?: boolean,
): void {
  const leaks = detectSecretLeak(state, vault.values());
  if (leaks.length > 0) {
    // NUNCA imprime o valor — só o alarme (defesa em profundidade).
    outcome.logs.push(`ERRO INTERNO: ${leaks.length} secret(s) vazaram no state — abortado.`);
    outcome.ok = false;
  }
  if (!quiet && outcome.ok && outcome.adminPassword) {
    outcome.logs.push(
      `Handoff (${kind}): senha temporária do admin impressa UMA vez — troque no 1º login + TOTP.`,
    );
  }
}

/** Path do state file (reexport para a CLI reportar onde o state ficou). */
export { stateFilePath };
