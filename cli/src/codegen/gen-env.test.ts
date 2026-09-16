// S2.7 — testes do gerador gen-env (D5: Supabase vs Neon).
//
// Estes são os testes que RODAM EM CI (sem banco): provam a montagem correta das
// connection strings por provider. Os cenários e2e (com banco real) são
// local-only (AC4) — não cobertos aqui.

import { describe, it, expect } from "vitest";
import type { ClientConfig } from "@cms-core/core/config";
import { renderEnv, buildDbUrls, type EnvSecrets } from "./gen-env.js";
import { demoCorpConfig } from "../../../templates/config-examples/demo-corp.config.js";

const SECRETS: EnvSecrets = {
  dbPassword: "s3cr3t",
  supabaseProjectRef: "abcdefghijklmno",
  supabaseUrl: "https://abcdefghijklmno.supabase.co",
  supabasePublishableKey: "sb_publishable_x",
  supabaseServiceRoleKey: "sb_secret_x",
  bunnyStorageKey: "bunny-key",
  resendApiKey: "re_x",
  readApiKey: "read-x",
  webhookSigningKey: "wh-x",
  previewTokenSecret: "prev-x",
};

// Config Neon: mesmo baseline, trocando só o database.kind.
const neonConfig: ClientConfig = {
  ...demoCorpConfig,
  providers: {
    ...demoCorpConfig.providers,
    database: { kind: "neon", region: "aws-sa-east-1", plan: "free" },
  },
};

const neonSecrets: EnvSecrets = {
  ...SECRETS,
  neonHost: "ep-cool-name-123456.sa-east-1.aws.neon.tech",
  neonDbName: "neondb",
  neonUser: "neondb_owner",
};

describe("gen-env — Supabase (Supavisor)", () => {
  const { databaseUrl, directUrl } = buildDbUrls(demoCorpConfig, SECRETS);

  it("DATABASE_URL usa a porta pooled :6543", () => {
    expect(databaseUrl).toContain(":6543");
    expect(databaseUrl).toContain("pooler.supabase.com");
  });

  it("DIRECT_URL usa a porta direta :5432", () => {
    expect(directUrl).toContain(":5432");
    expect(directUrl).toContain("db.abcdefghijklmno.supabase.co");
  });

  it("ambas as URLs têm ?sslmode=require", () => {
    expect(databaseUrl).toContain("?sslmode=require");
    expect(directUrl).toContain("?sslmode=require");
  });

  it("usuário do pooled inclui o project-ref (postgres.<ref>)", () => {
    expect(databaseUrl).toContain("postgres.abcdefghijklmno:");
  });
});

describe("gen-env — Neon", () => {
  const { databaseUrl, directUrl } = buildDbUrls(neonConfig, neonSecrets);

  it("DATABASE_URL usa o endpoint -pooler", () => {
    expect(databaseUrl).toContain("-pooler");
    expect(databaseUrl).toContain(
      "ep-cool-name-123456-pooler.sa-east-1.aws.neon.tech",
    );
  });

  it("DIRECT_URL NÃO usa -pooler (endpoint direto)", () => {
    expect(directUrl).not.toContain("-pooler");
    expect(directUrl).toContain(
      "ep-cool-name-123456.sa-east-1.aws.neon.tech",
    );
  });

  it("ambas as URLs têm ?sslmode=require", () => {
    expect(databaseUrl).toContain("?sslmode=require");
    expect(directUrl).toContain("?sslmode=require");
  });
});

describe("gen-env — .env.local completo", () => {
  const out = renderEnv(demoCorpConfig, SECRETS);

  it("header AUTO-GERADO + aviso de não-commit", () => {
    expect(out).toContain("AUTO-GERADO");
    expect(out).toContain("NÃO commitar");
  });

  it("inclui DATABASE_URL, DIRECT_URL e as envs de auth/media/email/secrets", () => {
    for (const key of [
      "DATABASE_URL=",
      "DIRECT_URL=",
      "NEXT_PUBLIC_SUPABASE_URL=",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=",
      "SUPABASE_SERVICE_ROLE_KEY=",
      "BUNNY_STORAGE_ZONE=",
      "BUNNY_CDN_URL=",
      "BUNNY_STORAGE_KEY=",
      "RESEND_API_KEY=",
      "SITE_URL=",
      "READ_API_KEY=",
      "WEBHOOK_SIGNING_KEY=",
      "PREVIEW_TOKEN_SECRET=",
    ]) {
      expect(out).toContain(key);
    }
  });

  it("Bunny zone/cdn e SITE_URL vêm do config (não secrets)", () => {
    expect(out).toContain('BUNNY_STORAGE_ZONE="demo-corp-media"');
    expect(out).toContain('BUNNY_CDN_URL="https://demo-corp.b-cdn.net"');
    expect(out).toContain('SITE_URL="https://www.example.com"');
  });

  it("secrets ausentes viram placeholder REPLACE_ME", () => {
    const partial = renderEnv(demoCorpConfig, {});
    expect(partial).toContain("REPLACE_ME");
  });

  it("é determinístico p/ o mesmo input", () => {
    expect(renderEnv(demoCorpConfig, SECRETS)).toBe(out);
  });
});
