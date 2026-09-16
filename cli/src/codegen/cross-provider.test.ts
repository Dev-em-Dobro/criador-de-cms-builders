// S5.5 — teste de equivalência cross-provider (D5).
//
// Roda o pipeline COMPLETO de codegen (`runCodegen`) para o baseline Supabase e
// para a variante Neon (o MESMO config, trocando só `providers.database.kind`),
// cada um em um dir temporário, e prova:
//   (a) os artefatos gerados são IDÊNTICOS entre os dois providers EXCETO
//       `.env.local` (URLs) e `db/schema/profiles.generated.ts` (FK omitida);
//   (b) em `profiles.generated.ts`, só a FK auth + o import authUsers mudam — as
//       COLUNAS são idênticas.
//
// O smoke test LIVE contra Neon/Supabase reais precisa de tokens e banco — fica
// FORA deste teste (pendente de tokens; ver relatório de S5). Aqui provamos a
// equivalência de GERAÇÃO (estática, offline, determinística).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { runCodegen } from "./index.js";
import { demoCorpConfig } from "../../../templates/config-examples/demo-corp.config.js";
import { demoCorpNeonConfig } from "../../../templates/config-examples/demo-corp-neon.config.js";

// Arquivos gerados que PODEM legitimamente diferir entre providers (D5).
const ALLOWED_DIVERGENT = new Set<string>([
  ".env.local",
  join("db", "schema", "profiles.generated.ts"),
]);

let supaDir: string;
let neonDir: string;
let supaFiles: string[];
let neonFiles: string[];

// Secrets REALISTAS por provider — para o `.env.local` mostrar as connection
// strings finais (Supavisor :6543 vs endpoint Neon `-pooler`) em vez de só
// placeholders. Sem eles o host fica "REPLACE_ME" e o `-pooler` não é injetável.
const SUPA_SECRETS = {
  CMS_DB_PASSWORD: "pw-supa",
  CMS_SUPABASE_PROJECT_REF: "abcdefgh",
};
const NEON_SECRETS = {
  CMS_DB_PASSWORD: "pw-neon",
  CMS_NEON_HOST: "ep-cool-name-123456.sa-east-1.aws.neon.tech",
};

function withEnv(vars: Record<string, string>, fn: () => void): void {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  process.env.CMS_FORCE_ENV = "1"; // escreve o `.env.local` no dir vazio.
  try {
    fn();
  } finally {
    for (const [k] of Object.entries(vars)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    delete process.env.CMS_FORCE_ENV;
  }
}

beforeAll(() => {
  supaDir = mkdtempSync(join(tmpdir(), "cms-supa-"));
  neonDir = mkdtempSync(join(tmpdir(), "cms-neon-"));
  // MESMO `configExportName` nos dois: o nome do export é uma propriedade do
  // ARQUIVO de config (o scaffold copia como `client.config.ts`), não do provider.
  // Mantê-lo constante isola as diferenças reais a env + profiles (o objetivo do
  // teste). Nos dois casos os campos NÃO-database do config são idênticos (o neon
  // é o baseline com só `database` trocado).
  const EXPORT_NAME = "clientConfig";
  withEnv(SUPA_SECRETS, () => {
    supaFiles = runCodegen(demoCorpConfig, supaDir, {
      configExportName: EXPORT_NAME,
    }).written.map((p) => relative(supaDir, p));
  });
  withEnv(NEON_SECRETS, () => {
    neonFiles = runCodegen(demoCorpNeonConfig, neonDir, {
      configExportName: EXPORT_NAME,
    }).written.map((p) => relative(neonDir, p));
  });
});

afterAll(() => {
  rmSync(supaDir, { recursive: true, force: true });
  rmSync(neonDir, { recursive: true, force: true });
});

describe("cross-provider — mesma lista de artefatos", () => {
  it("gera exatamente o mesmo conjunto de arquivos (mesmos paths relativos)", () => {
    expect([...neonFiles].sort()).toEqual([...supaFiles].sort());
  });
});

describe("cross-provider — todos os artefatos idênticos EXCETO env + profiles", () => {
  it("cada arquivo não-divergente é byte-idêntico entre supabase e neon", () => {
    const divergent: string[] = [];
    for (const rel of supaFiles) {
      const a = readFileSync(join(supaDir, rel), "utf8");
      const b = readFileSync(join(neonDir, rel), "utf8");
      if (a !== b) divergent.push(rel);
    }
    // O ÚNICO conjunto de arquivos que difere deve ser subconjunto do permitido.
    for (const d of divergent) {
      expect(ALLOWED_DIVERGENT.has(d)).toBe(true);
    }
    // E os dois divergentes esperados DEVEM de fato ter divergido.
    expect(divergent).toContain(".env.local");
    expect(divergent).toContain(join("db", "schema", "profiles.generated.ts"));
  });
});

describe("cross-provider — profiles: só a FK muda, colunas idênticas", () => {
  const supaProfiles = () =>
    readFileSync(join(supaDir, "db", "schema", "profiles.generated.ts"), "utf8");
  const neonProfiles = () =>
    readFileSync(join(neonDir, "db", "schema", "profiles.generated.ts"), "utf8");

  it("supabase TEM a FK auth; neon NÃO tem", () => {
    expect(supaProfiles()).toContain("profiles_id_auth_users_fk");
    expect(supaProfiles()).toContain("drizzle-orm/supabase");
    expect(neonProfiles()).not.toContain("profiles_id_auth_users_fk");
    expect(neonProfiles()).not.toContain("drizzle-orm/supabase");
  });

  it("as MESMAS colunas aparecem nos dois (equivalência de schema de dados)", () => {
    const cols = [
      'id: uuid("id").primaryKey()',
      'email: text("email").notNull().unique()',
      'role: roleEnum("role").notNull().default("editor")',
      'status: userStatusEnum("status").notNull().default("invited")',
      'lastLoginAt: timestamp("last_login_at", { withTimezone: true })',
      'createdAt: timestamp("created_at", { withTimezone: true })',
      'updatedAt: timestamp("updated_at", { withTimezone: true })',
    ];
    for (const c of cols) {
      expect(supaProfiles()).toContain(c);
      expect(neonProfiles()).toContain(c);
    }
  });
});

describe("cross-provider — env: DATABASE_URL/DIRECT_URL por provider", () => {
  it("supabase usa Supavisor pooler (:6543) + host db.<ref>; neon usa -pooler", () => {
    const supaEnv = readFileSync(join(supaDir, ".env.local"), "utf8");
    const neonEnv = readFileSync(join(neonDir, ".env.local"), "utf8");
    // Supabase: pooler regional :6543 + host direto db.<ref>.supabase.co :5432.
    expect(supaEnv).toContain("pooler.supabase.com:6543");
    expect(supaEnv).toContain(".supabase.co:5432");
    // Neon: endpoint -pooler (pooled) e endpoint direto, ambos sslmode=require.
    expect(neonEnv).toContain("-pooler");
    expect(neonEnv).toContain("sslmode=require");
    // Nenhum artefato de banco Neon aparece no env Supabase e vice-versa.
    expect(neonEnv).not.toContain("pooler.supabase.com:6543");
  });
});

describe("cross-provider — sanity: ambos os dirs realmente materializaram", () => {
  it("os arquivos de schema/lib existem nos dois workspaces", () => {
    for (const dir of [supaDir, neonDir]) {
      expect(existsSync(join(dir, "db", "schema", "enums.generated.ts"))).toBe(
        true,
      );
      expect(
        existsSync(join(dir, "db", "schema", "profiles.generated.ts")),
      ).toBe(true);
      expect(existsSync(join(dir, ".env.local"))).toBe(true);
    }
  });
});
