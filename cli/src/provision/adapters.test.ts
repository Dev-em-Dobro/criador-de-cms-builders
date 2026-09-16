// S4.3/S4.6/S4.10 — testes unitários de adapters específicos (modo auth-only,
// env builder do Vercel via buildDbUrls, Neon monta URLs de conteúdo).

import { describe, it, expect } from "vitest";
import { FakeHttpClient } from "./http.js";
import { SecretVault } from "./secrets.js";
import { createLogger } from "./logger.js";
import { createSupabaseAdapter } from "./supabase.js";
import { createNeonAdapter } from "./neon.js";
import { buildVercelEnv } from "./vercel.js";
import type { ProvisionCtx, CollectedEnv } from "./types.js";
import { supabaseConfig, neonConfig, fullTokens } from "./__fixtures__/configs.js";
import { supabaseHandler, neonHandler } from "./__fixtures__/fake-providers.js";

function mkCtx(overrides: Partial<ProvisionCtx> = {}): ProvisionCtx {
  const vault = new SecretVault();
  return {
    config: supabaseConfig,
    http: new FakeHttpClient(),
    tokens: fullTokens,
    vault,
    state: { slug: "acme", databaseKind: "supabase", resources: {} },
    env: {},
    dryRun: false,
    log: createLogger(vault, { toConsole: false }),
    maxPolls: 3,
    pollIntervalMs: 0,
    ...overrides,
  };
}

describe("Supabase adapter — modo auth-only (§13.3)", () => {
  it("auth-only NÃO monta supabaseProjectRef (origem de conteúdo)", async () => {
    const env: CollectedEnv = {};
    const ctx = mkCtx({
      config: neonConfig,
      http: new FakeHttpClient([supabaseHandler()]),
      env,
      supabaseRole: "auth-only",
      state: { slug: "acme", databaseKind: "neon", resources: {} },
    });
    await createSupabaseAdapter("auth-only").ensure(ctx);
    expect(env.supabaseProjectRef).toBeUndefined(); // conteúdo é o Neon
    expect(env.supabaseUrl).toContain("supabase.co"); // auth sim
    // grava sob a chave de estado auth-only e usa o nome determinístico <slug>-auth.
    expect(ctx.state.resources["supabase-auth"].status).toBe("verified");
    expect(ctx.state.resources["supabase-auth"].name).toBe("acme-auth");
  });

  it("content-and-auth monta supabaseProjectRef (origem de conteúdo)", async () => {
    const env: CollectedEnv = {};
    const ctx = mkCtx({
      http: new FakeHttpClient([supabaseHandler()]),
      env,
      supabaseRole: "content-and-auth",
    });
    await createSupabaseAdapter("content-and-auth").ensure(ctx);
    expect(env.supabaseProjectRef).toBeTruthy();
  });
});

describe("Neon adapter — monta host de conteúdo (S4.10)", () => {
  it("grava neonHost/neonUser e a senha vai ao cofre (não ao env)", async () => {
    const env: CollectedEnv = {};
    const vault = new SecretVault();
    const ctx = mkCtx({
      config: neonConfig,
      http: new FakeHttpClient([neonHandler()]),
      env,
      vault,
      state: { slug: "acme", databaseKind: "neon", resources: {} },
    });
    await createNeonAdapter().ensure(ctx);
    expect(env.neonHost).toContain("neon.tech");
    expect(env.neonUser).toBe("neondb_owner");
    expect(vault.get("neonPassword")).toBe("NEON_PW_SECRET");
    expect(ctx.state.resources.neon.status).toBe("verified");
  });
});

describe("buildVercelEnv — reusa buildDbUrls (D5)", () => {
  it("caso supabase: DATABASE_URL usa pooler:6543 e as 13 envs estão presentes", () => {
    const vault = new SecretVault();
    vault.set("supabaseDbPassword", "PW");
    const ctx = mkCtx({
      vault,
      env: { supabaseProjectRef: "ref123", supabaseUrl: "https://ref123.supabase.co" },
    });
    const envs = buildVercelEnv(ctx);
    const byKey = Object.fromEntries(envs.map((e) => [e.key, e.value]));
    expect(byKey.DATABASE_URL).toContain(":6543");
    expect(byKey.DATABASE_URL).toContain("sslmode=require");
    expect(envs.length).toBe(13);
    // secrets sensíveis marcados encrypted.
    const svc = envs.find((e) => e.key === "SUPABASE_SERVICE_ROLE_KEY");
    expect(svc?.type).toBe("encrypted");
  });

  it("caso neon: DATABASE_URL usa endpoint -pooler", () => {
    const vault = new SecretVault();
    vault.set("neonPassword", "PW");
    const ctx = mkCtx({
      config: neonConfig,
      vault,
      env: { neonHost: "ep-cool-123.sa-east-1.aws.neon.tech", neonUser: "neondb_owner", neonDbName: "neondb" },
      state: { slug: "acme", databaseKind: "neon", resources: {} },
    });
    const byKey = Object.fromEntries(buildVercelEnv(ctx).map((e) => [e.key, e.value]));
    expect(byKey.DATABASE_URL).toContain("-pooler");
    expect(byKey.DIRECT_URL).not.toContain("-pooler");
  });
});
