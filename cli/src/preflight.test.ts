// S4.11 — testes de preflight (presença de tokens; Neon condicional).

import { describe, it, expect } from "vitest";
import { preflight, parseDotEnv, tokensFromEnv } from "./preflight.js";
import { supabaseConfig, neonConfig, fullTokens } from "./provision/__fixtures__/configs.js";

describe("parseDotEnv", () => {
  it("ignora comentários e linhas vazias; tira aspas", () => {
    const env = parseDotEnv('# c\n\nA=1\nB="dois"\nC=\n');
    expect(env).toEqual({ A: "1", B: "dois", C: "" });
  });
});

describe("tokensFromEnv", () => {
  it("mapeia os nomes de env var para OperatorTokens", () => {
    const t = tokensFromEnv({
      SUPABASE_ACCESS_TOKEN: "x",
      NEON_API_KEY: "n",
      VERCEL_TEAM_ID: "team",
    });
    expect(t.supabaseAccessToken).toBe("x");
    expect(t.neonApiKey).toBe("n");
    expect(t.vercelTeamId).toBe("team");
  });
});

describe("preflight — presença de tokens", () => {
  it("passa com todos os tokens (config supabase, sem exigir Neon)", () => {
    const r = preflight([supabaseConfig], fullTokens);
    expect(r.ok).toBe(true);
    expect(r.needsNeon).toBe(false);
    expect(r.missing).toEqual([]);
  });

  it("falha sem os tokens obrigatórios", () => {
    const r = preflight([supabaseConfig], {});
    expect(r.ok).toBe(false);
    expect(r.missing).toContain("SUPABASE_ACCESS_TOKEN");
    expect(r.missing).toContain("VERCEL_TOKEN");
    // NÃO exige Neon (config é supabase).
    expect(r.missing).not.toContain("NEON_API_KEY");
  });

  it("exige NEON_API_KEY só quando algum config usa database=neon", () => {
    const semNeon = preflight([neonConfig], { ...fullTokens, neonApiKey: undefined });
    expect(semNeon.needsNeon).toBe(true);
    expect(semNeon.ok).toBe(false);
    expect(semNeon.missing).toEqual(["NEON_API_KEY"]);

    const comNeon = preflight([neonConfig], fullTokens);
    expect(comNeon.ok).toBe(true);
  });

  it("clientes 100% Supabase não precisam do token Neon", () => {
    const r = preflight([supabaseConfig], { ...fullTokens, neonApiKey: undefined });
    expect(r.ok).toBe(true);
  });
});
