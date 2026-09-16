// S4.1 + S4.7 — testes do orquestrador com FakeHttpClient (sem tokens/rede).
//
// Provam: composição por database.kind (supabase vs neon 2-provedores);
// idempotência (2ª run reconcilia, não duplica); rollback em ordem inversa numa
// falha parcial simulada; --dry-run produz plano sem chamadas HTTP; secrets
// nunca aparecem no state nem no log.

import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { provision, composeAdapters } from "./orchestrator.js";
import { FakeHttpClient } from "./http.js";
import { stateFilePath } from "./state.js";
import { supabaseConfig, neonConfig, fullTokens } from "./__fixtures__/configs.js";
import {
  supabaseHandler,
  neonHandler,
  bunnyHandler,
  resendHandler,
  vercelHandler,
} from "./__fixtures__/fake-providers.js";

let repoRoot: string;
beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), "prov-"));
});

const fastPolls = { maxPolls: 3, pollIntervalMs: 0 };

function happyHttp(kind: "supabase" | "neon"): FakeHttpClient {
  const handlers = [bunnyHandler(), resendHandler(), vercelHandler()];
  if (kind === "neon") handlers.unshift(neonHandler(), supabaseHandler());
  else handlers.unshift(supabaseHandler());
  return new FakeHttpClient(handlers);
}

// ── Composição por database.kind (D5) ────────────────────────────────────────
describe("composeAdapters — ordem por database.kind", () => {
  it("supabase → [supabase(conteúdo+auth), bunny, resend, vercel]", () => {
    const comp = composeAdapters(supabaseConfig).map((s) => s.stateKey);
    expect(comp).toEqual(["supabase", "bunny", "resend", "vercel"]);
  });

  it("neon → [neon, supabase(auth-only), bunny, resend, vercel] (2 adapters de banco)", () => {
    const comp = composeAdapters(neonConfig).map((s) => s.stateKey);
    expect(comp).toEqual(["neon", "supabase-auth", "bunny", "resend", "vercel"]);
    // o adapter supabase no caso neon é auth-only.
    const supa = composeAdapters(neonConfig).find((s) => s.stateKey === "supabase-auth");
    expect(supa?.supabaseRole).toBe("auth-only");
  });
});

// ── Dry-run: plano sem chamadas HTTP ─────────────────────────────────────────
describe("--dry-run — plan-only, zero chamadas", () => {
  it("supabase: não faz nenhuma request HTTP", async () => {
    const http = new FakeHttpClient();
    const outcome = await provision({
      config: supabaseConfig,
      repoRoot,
      tokens: {}, // sem tokens!
      http,
      dryRun: true,
      quiet: true,
    });
    expect(outcome.ok).toBe(true);
    expect(http.calls.length).toBe(0);
    // não persiste state file no dry-run.
    expect(existsSync(stateFilePath(repoRoot, supabaseConfig.slug))).toBe(false);
  });

  it("neon: plano lista os 5 adapters na ordem 2-provedores, zero chamadas", async () => {
    const http = new FakeHttpClient();
    const outcome = await provision({
      config: neonConfig,
      repoRoot,
      tokens: {},
      http,
      dryRun: true,
      quiet: true,
    });
    expect(http.calls.length).toBe(0);
    expect(outcome.composition).toEqual([
      "Neon (conteúdo)",
      "Supabase (auth-only)",
      "Bunny.net (mídia)",
      "Resend (email)",
      "Vercel (deploy)",
    ]);
  });
});

// ── Caminho feliz + idempotência ─────────────────────────────────────────────
describe("provision (supabase) — caminho feliz", () => {
  it("cria todos os recursos e marca verified", async () => {
    const outcome = await provision({
      config: supabaseConfig,
      repoRoot,
      tokens: fullTokens,
      http: happyHttp("supabase"),
      quiet: true,
      ...fastPolls,
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.failedAt).toBeUndefined();
    for (const key of ["supabase", "bunny", "vercel"]) {
      expect(outcome.state.resources[key].status).toBe("verified");
    }
    // senha admin impressa uma vez.
    expect(outcome.adminPassword).toBeTruthy();
  });

  it("2ª run reconcilia (não recria) — recursos não marcados createdThisRun", async () => {
    // 1ª run cria tudo.
    await provision({
      config: supabaseConfig,
      repoRoot,
      tokens: fullTokens,
      http: happyHttp("supabase"),
      quiet: true,
      ...fastPolls,
    });
    // 2ª run: os projetos agora "existem" (handler os retorna na list).
    const http2 = new FakeHttpClient([
      supabaseHandler([`${supabaseConfig.slug}-cms`]),
      bunnyHandler(),
      resendHandler(),
      vercelHandler(),
    ]);
    const outcome2 = await provision({
      config: supabaseConfig,
      repoRoot,
      tokens: fullTokens,
      http: http2,
      quiet: true,
      ...fastPolls,
    });
    expect(outcome2.ok).toBe(true);
    // não houve POST de criação de projeto Supabase na 2ª run (reconciliou).
    const createCalls = http2.callsMatching(
      (c) => c.method === "POST" && c.url.includes("/v1/projects") && !c.url.includes("config/auth"),
    );
    expect(createCalls.length).toBe(0);
    expect(outcome2.state.resources.supabase.createdThisRun).toBe(false);
  });
});

describe("provision (neon 2-provedores) — caminho feliz", () => {
  it("cria Neon + Supabase auth-only + resto; auth-only não monta DATABASE_URL", async () => {
    const outcome = await provision({
      config: neonConfig,
      repoRoot,
      tokens: fullTokens,
      http: happyHttp("neon"),
      quiet: true,
      ...fastPolls,
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.state.resources.neon.status).toBe("verified");
    expect(outcome.state.resources["supabase-auth"].status).toBe("verified");
    // Neon é a origem do host de conteúdo.
    expect(outcome.env.neonHost).toContain("neon.tech");
    // auth-only NÃO define supabaseProjectRef (origem de conteúdo).
    expect(outcome.env.supabaseProjectRef).toBeUndefined();
    // mas define a URL de auth.
    expect(outcome.env.supabaseUrl).toContain("supabase.co");
  });
});

// ── Rollback em ordem inversa numa falha parcial ─────────────────────────────
describe("falha parcial → rollback em ordem inversa (S4.7)", () => {
  it("supabase: Vercel falha → rollback Resend→Bunny→Supabase (só criados nesta run)", async () => {
    const http = new FakeHttpClient([
      supabaseHandler(),
      bunnyHandler(),
      resendHandler(),
      vercelHandler({ failCreate: true }), // Vercel recusa o projeto
    ]);
    const outcome = await provision({
      config: supabaseConfig,
      repoRoot,
      tokens: fullTokens,
      http,
      quiet: true,
      ...fastPolls,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.failedAt).toBe("vercel");

    // deletes emitidos na ordem inversa: resend, bunny, supabase.
    const deletes = http.callsMatching((c) => c.method === "DELETE");
    const order = deletes.map((d) => {
      if (d.url.includes("/domains/")) return "resend";
      if (d.url.includes("/storagezone/")) return "bunny";
      if (d.url.includes("/v1/projects/")) return "supabase";
      return "other";
    });
    // resend antes de bunny antes de supabase (ordem inversa da composição).
    expect(order.indexOf("resend")).toBeLessThan(order.indexOf("bunny"));
    expect(order.indexOf("bunny")).toBeLessThan(order.indexOf("supabase"));
    expect(outcome.orphans.length).toBe(0); // todos os rollbacks deram certo
  });

  it("neon: Vercel falha → rollback inclui os DOIS recursos de banco (Supabase auth-only + Neon)", async () => {
    const http = new FakeHttpClient([
      neonHandler(),
      supabaseHandler(),
      bunnyHandler(),
      resendHandler(),
      vercelHandler({ failCreate: true }),
    ]);
    const outcome = await provision({
      config: neonConfig,
      repoRoot,
      tokens: fullTokens,
      http,
      quiet: true,
      ...fastPolls,
    });
    expect(outcome.ok).toBe(false);
    const deletes = http.callsMatching((c) => c.method === "DELETE");
    // Neon DELETE presente (o banco de conteúdo entra no rollback).
    const neonDelete = deletes.find((d) => d.url.includes("console.neon.tech") && d.method === "DELETE");
    const supaDelete = deletes.find((d) => d.url.includes("/v1/projects/"));
    expect(neonDelete).toBeTruthy();
    expect(supaDelete).toBeTruthy();
    // ordem inversa: supabase(auth-only) deletado ANTES do neon.
    const supaIdx = deletes.indexOf(supaDelete!);
    const neonIdx = deletes.indexOf(neonDelete!);
    expect(supaIdx).toBeLessThan(neonIdx);
  });
});

// ── Segredos: nunca no state nem no log ──────────────────────────────────────
describe("secrets nunca vazam (S4.2 / §7.6)", () => {
  it("state file não contém nenhum valor de secret", async () => {
    const outcome = await provision({
      config: neonConfig,
      repoRoot,
      tokens: fullTokens,
      http: happyHttp("neon"),
      quiet: true,
      ...fastPolls,
    });
    expect(outcome.ok).toBe(true);
    const stateJson = readFileSync(stateFilePath(repoRoot, neonConfig.slug), "utf8");
    for (const secret of [
      "SUPA_SERVICE_ROLE_SECRET",
      "SUPA_ANON_KEY_SECRET",
      "BUNNY_ZONE_PW_SECRET",
      "NEON_PW_SECRET",
      outcome.adminPassword!,
    ]) {
      expect(stateJson).not.toContain(secret);
    }
  });

  it("logs redigem os valores de secret coletados", async () => {
    const outcome = await provision({
      config: supabaseConfig,
      repoRoot,
      tokens: fullTokens,
      http: happyHttp("supabase"),
      quiet: true,
      ...fastPolls,
    });
    const joined = outcome.logs.join("\n");
    for (const secret of ["SUPA_SERVICE_ROLE_SECRET", "BUNNY_ZONE_PW_SECRET", outcome.adminPassword!]) {
      expect(joined).not.toContain(secret);
    }
  });
});
