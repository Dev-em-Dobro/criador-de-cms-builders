// @cms-core/cli — deploy: migrate + seed + smoke test (S4.8) e redeploy hooks
// (S4.9). ESQUELETO — a execução REAL exige banco/tokens; deixada explícita.
//
// § IMPORTANTE (escopo Fase 4 dry-run/mock):
//   • S4.8 (migrate/seed/smoke REAL) e S4.9 (CI redeploy) precisam de banco e
//     tokens de verdade. Aqui está a ESTRUTURA/orquestração; a execução real é
//     marcada como pendente. O smoke test é mockável no nível de orquestração
//     (via `runStep` injetável), mas NÃO finge sucesso sem um executor real.
//   • S4.11 E2E completo depende de S5.2 (Fase 5) — o gen-env já monta as URLs;
//     o schema condicional `profiles` (Neon) é a S5.3, ainda não feita.

import type { ClientConfig } from "@cms-core/core/config";
import type { CollectedEnv, ProvisionLogger } from "./types.js";

/** Um passo de deploy — executado por um runner injetável (shell/db). */
export interface DeployStep {
  id: "migrate" | "seed-admin" | "smoke-read" | "smoke-login";
  label: string;
  /** o que o passo FARIA (para o plano dry-run). */
  describe: string;
}

/** Runner injetável de um passo — em prod roda shell/db; nos testes é um stub. */
export type StepRunner = (step: DeployStep, ctx: DeployCtx) => Promise<StepResult>;

export interface StepResult {
  ok: boolean;
  /** true se o passo foi pulado por depender de recurso ainda indisponível. */
  skipped?: boolean;
  detail?: string;
}

export interface DeployCtx {
  config: ClientConfig;
  env: CollectedEnv;
  log: ProvisionLogger;
  dryRun: boolean;
  /**
   * runner real dos passos. AUSENTE ⇒ nenhum passo é realmente executado: cada
   * passo retorna `skipped` (pendente de banco/tokens). Isto é intencional —
   * nunca fingimos sucesso de migrate/seed/smoke sem um executor real (S4.8).
   */
  runStep?: StepRunner;
}

/** Os passos de deploy na ordem (§7.3 pós-provision → §8). */
export function deploySteps(config: ClientConfig): DeployStep[] {
  return [
    {
      id: "migrate",
      label: "Migrate (drizzle)",
      describe: `aplicar migrations no DIRECT_URL do banco de conteúdo (${config.providers.database.kind}).`,
    },
    {
      id: "seed-admin",
      label: "Seed admin",
      describe: `criar o usuário admin (${config.seedAdmin.email}) idempotente + profiles.`,
    },
    {
      id: "smoke-login",
      label: "Smoke: login bootstrap",
      describe: "login bootstrap do admin (MFA) — valida o Supabase auth.",
    },
    {
      id: "smoke-read",
      label: "Smoke: read API",
      describe: "criar/publicar 1 entry + GET read API → 200.",
    },
  ];
}

/**
 * Orquestra os passos de deploy. Sem `runStep`, cada passo é reportado como
 * PENDENTE (skipped) — a estrutura existe e é testável, mas a execução real
 * depende de banco/tokens (S4.8) e do schema condicional da Fase 5 (S4.11/S5.3).
 */
export async function runDeploy(ctx: DeployCtx): Promise<{
  ok: boolean;
  results: Array<{ step: DeployStep; result: StepResult }>;
  pending: string[];
}> {
  const steps = deploySteps(ctx.config);
  const results: Array<{ step: DeployStep; result: StepResult }> = [];
  const pending: string[] = [];

  for (const step of steps) {
    if (ctx.dryRun) {
      ctx.log.plan(`Deploy/${step.label}: ${step.describe}`);
      results.push({ step, result: { ok: true, skipped: true, detail: "dry-run" } });
      continue;
    }
    if (!ctx.runStep) {
      // sem executor real → PENDENTE (nunca finge sucesso).
      ctx.log.warn(`Deploy/${step.label}: PENDENTE (requer banco/tokens — S4.8). ${step.describe}`);
      pending.push(step.id);
      results.push({ step, result: { ok: false, skipped: true, detail: "pendente: sem executor real" } });
      continue;
    }
    const result = await ctx.runStep(step, ctx);
    results.push({ step, result });
    if (!result.ok && !result.skipped) {
      ctx.log.warn(`Deploy/${step.label}: FALHOU — ${result.detail ?? ""}`);
      return { ok: false, results, pending };
    }
  }

  const ok = ctx.dryRun ? true : results.every((r) => r.result.ok || r.result.skipped) && pending.length === 0;
  return { ok, results, pending };
}

/**
 * S4.9 (esqueleto): após um fix no core, redeploy dos `clients/*` afetados. A CI
 * roda typecheck + testes de todos os workspaces (gate S1.5) e então redeploy —
 * sem publish/bump (D1 monorepo). Aqui só a ESTRUTURA; a execução real é a Fase
 * de CI hooks (§3, §7.7).
 */
export interface RedeployPlan {
  reason: string;
  workspaces: string[];
  /** ordem: gate (typecheck+test+drizzle check) → redeploy. */
  steps: string[];
}

export function planRedeployAfterCoreFix(affectedSlugs: string[]): RedeployPlan {
  return {
    reason: "fix em packages/core (workspace:* linkado — vale p/ todos os clients).",
    workspaces: affectedSlugs,
    steps: [
      "pnpm -r --filter './clients/*' run typecheck",
      "pnpm -r --filter './clients/*' run test",
      "drizzle-kit check por workspace afetado (anti-drift)",
      "redeploy Vercel de cada workspace afetado (sem bump)",
    ],
  };
}
