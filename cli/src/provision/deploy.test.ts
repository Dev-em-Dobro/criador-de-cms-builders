// S4.8 (esqueleto) — testes do deploy: dry-run planeja; sem executor real os
// passos ficam PENDENTES (nunca fingem sucesso); com stub, orquestra na ordem.

import { describe, it, expect } from "vitest";
import { runDeploy, deploySteps, planRedeployAfterCoreFix } from "./deploy.js";
import { SecretVault } from "./secrets.js";
import { createLogger } from "./logger.js";
import { supabaseConfig } from "./__fixtures__/configs.js";

const mkLog = () => createLogger(new SecretVault(), { toConsole: false });

describe("deploySteps", () => {
  it("emite migrate → seed-admin → smoke-login → smoke-read", () => {
    const ids = deploySteps(supabaseConfig).map((s) => s.id);
    expect(ids).toEqual(["migrate", "seed-admin", "smoke-login", "smoke-read"]);
  });
});

describe("runDeploy — dry-run", () => {
  it("planeja todos os passos como skipped, ok=true", async () => {
    const out = await runDeploy({ config: supabaseConfig, env: {}, log: mkLog(), dryRun: true });
    expect(out.ok).toBe(true);
    expect(out.results.every((r) => r.result.skipped)).toBe(true);
  });
});

describe("runDeploy — sem executor real (S4.8 pendente)", () => {
  it("marca todos os passos como PENDENTES (não finge sucesso)", async () => {
    const out = await runDeploy({ config: supabaseConfig, env: {}, log: mkLog(), dryRun: false });
    expect(out.ok).toBe(false); // não pode dar ok sem executor real
    expect(out.pending).toEqual(["migrate", "seed-admin", "smoke-login", "smoke-read"]);
  });
});

describe("runDeploy — com stub de executor (smoke mockado)", () => {
  it("orquestra os passos na ordem e agrega o resultado", async () => {
    const ran: string[] = [];
    const out = await runDeploy({
      config: supabaseConfig,
      env: {},
      log: mkLog(),
      dryRun: false,
      runStep: async (step) => {
        ran.push(step.id);
        return { ok: true };
      },
    });
    expect(out.ok).toBe(true);
    expect(ran).toEqual(["migrate", "seed-admin", "smoke-login", "smoke-read"]);
  });

  it("aborta na primeira falha dura de um passo", async () => {
    const ran: string[] = [];
    const out = await runDeploy({
      config: supabaseConfig,
      env: {},
      log: mkLog(),
      dryRun: false,
      runStep: async (step) => {
        ran.push(step.id);
        return step.id === "seed-admin" ? { ok: false, detail: "boom" } : { ok: true };
      },
    });
    expect(out.ok).toBe(false);
    expect(ran).toEqual(["migrate", "seed-admin"]); // parou no seed
  });
});

describe("planRedeployAfterCoreFix (S4.9 esqueleto)", () => {
  it("lista os workspaces afetados + os passos de gate→redeploy", () => {
    const plan = planRedeployAfterCoreFix(["acme", "demo-corp"]);
    expect(plan.workspaces).toEqual(["acme", "demo-corp"]);
    expect(plan.steps.some((s) => s.includes("typecheck"))).toBe(true);
    expect(plan.steps.some((s) => s.includes("drizzle-kit check"))).toBe(true);
  });
});
