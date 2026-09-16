// @cms-core/cli — gen-env (S2.7, D5 / §13.1 / §3.9 / Apêndice C).
//
// ÚNICO gerador consciente de `database.kind` (§6.2 / AC2). Monta:
//   • DATABASE_URL (runtime, POOLED) e DIRECT_URL (migrations, DIRETO) por
//     provider — Supabase (Supavisor :6543 / :5432) vs Neon (`-pooler` / direto),
//     ambos com `?sslmode=require`.
//   • as demais envs (Supabase auth keys, Bunny, Resend, secrets) — idênticas
//     entre providers.
// Emite `clients/<slug>/.env.local` (NUNCA commitado — `.gitignore: **/.env.local`).
//
// SECRETS: NÃO vêm do config (Artigo IV / regra de segredos do validate.ts). São
// lidos de `process.env` (ou state file do provisioning na Fase 4). O config só
// dá kind/region/refs. Placeholders explícitos são usados quando um secret está
// ausente, para o `.env.local` ser preenchível manualmente em dev/e2e.
//
// Determinismo: ordem fixa das chaves; `.env.local` não é commitado nem comparado
// por snapshot — ordem só afeta legibilidade.

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { ClientConfig } from "@cms-core/core/config";
import { writeGenerated } from "./shared.js";

/** Secrets injetados por env/state (nunca do config). Todos opcionais — ausência
 * vira placeholder explícito no `.env.local`. */
export interface EnvSecrets {
  // Banco de conteúdo
  dbPassword?: string;
  supabaseProjectRef?: string; // caso supabase: project-ref do conteúdo+auth
  neonHost?: string; // caso neon: host base (ex.: "ep-cool-name-123456.sa-east-1.aws.neon.tech")
  neonDbName?: string; // default "neondb"
  neonUser?: string; // default "neondb_owner"
  // Auth (Supabase) — no caso neon, é o projeto auth-only
  supabaseUrl?: string;
  supabasePublishableKey?: string;
  supabaseServiceRoleKey?: string;
  // Media / email
  bunnyStorageKey?: string;
  /** Vercel Blob — token de leitura/escrita do store. */
  blobReadWriteToken?: string;
  resendApiKey?: string;
  // Secrets gerados
  readApiKey?: string;
  webhookSigningKey?: string;
  previewTokenSecret?: string;
}

const PLACEHOLDER = "REPLACE_ME";

function ph(value: string | undefined): string {
  return value ?? PLACEHOLDER;
}

// ---------------------------------------------------------------------------
// Construção das connection strings por provider (o coração de D5).
// ---------------------------------------------------------------------------

/** Monta DATABASE_URL (pooled) + DIRECT_URL (direto) para o provider do config. */
export function buildDbUrls(
  config: ClientConfig,
  secrets: EnvSecrets,
): { databaseUrl: string; directUrl: string } {
  const db = config.providers.database;
  const password = ph(secrets.dbPassword);

  if (db.kind === "supabase") {
    // Supavisor: pooled em :6543 (transaction mode), direto em :5432 (session).
    // Host pooler regional: aws-0-<region>.pooler.supabase.com; usuário inclui o
    // project-ref (postgres.<ref>). Host direto: db.<ref>.supabase.co.
    const ref = ph(secrets.supabaseProjectRef);
    const poolerHost = `aws-0-${db.region}.pooler.supabase.com`;
    const directHost = `db.${ref}.supabase.co`;
    return {
      databaseUrl: `postgres://postgres.${ref}:${password}@${poolerHost}:6543/postgres?sslmode=require`,
      directUrl: `postgres://postgres:${password}@${directHost}:5432/postgres?sslmode=require`,
    };
  }

  // Neon: endpoint `-pooler` (pooled) e endpoint direto (sem `-pooler`), ambos
  // ?sslmode=require. O host base é o endpoint direto; o pooled insere `-pooler`
  // no primeiro segmento (ep-xxx → ep-xxx-pooler).
  const host = ph(secrets.neonHost);
  const dbName = secrets.neonDbName ?? "neondb";
  const user = secrets.neonUser ?? "neondb_owner";
  const poolerHost = host.replace(/^(ep-[^.]+)/, "$1-pooler");
  return {
    databaseUrl: `postgres://${user}:${password}@${poolerHost}/${dbName}?sslmode=require`,
    directUrl: `postgres://${user}:${password}@${host}/${dbName}?sslmode=require`,
  };
}

// ---------------------------------------------------------------------------
// Render do `.env.local`.
// ---------------------------------------------------------------------------

/** Renderiza o conteúdo de `.env.local` (função pura — testável). */
export function renderEnv(config: ClientConfig, secrets: EnvSecrets): string {
  const { databaseUrl, directUrl } = buildDbUrls(config, secrets);
  const { siteUrl } = config.domains;
  const media = config.providers.media;

  /**
   * Bloco de mídia por provedor: Bunny precisa de zona + CDN + chave; Vercel
   * Blob precisa só do token (que a própria Vercel injeta nos deploys quando o
   * store está ligado ao projeto — o placeholder aqui é para rodar local).
   */
  const mediaLines =
    media.provider === "bunny"
      ? [
          "# --- Media (Bunny.net) ---",
          `BUNNY_STORAGE_ZONE="${media.storageZone}"`,
          `BUNNY_CDN_URL="${media.cdnUrl}"`,
          `BUNNY_STORAGE_KEY="${ph(secrets.bunnyStorageKey)}"`,
        ]
      : [
          "# --- Media (Vercel Blob) ---",
          "# Em deploy na Vercel a variável é injetada pelo store ligado ao projeto.",
          `BLOB_READ_WRITE_TOKEN="${ph(secrets.blobReadWriteToken)}"`,
        ];

  const lines = [
    "# AUTO-GERADO por cms-core generate — NÃO commitar (coberto por .gitignore).",
    `# Provider de banco: ${config.providers.database.kind} (D5). Secrets vêm do`,
    "# provisioning (env/state) — placeholders REPLACE_ME onde ausentes.",
    "",
    "# --- Database (D5: pooled runtime / direct migrations) ---",
    `DATABASE_URL="${databaseUrl}"`,
    `DIRECT_URL="${directUrl}"`,
    "",
    "# --- Supabase Auth (projeto auth; = conteúdo no caso supabase) ---",
    `NEXT_PUBLIC_SUPABASE_URL="${ph(secrets.supabaseUrl)}"`,
    `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="${ph(secrets.supabasePublishableKey)}"`,
    `SUPABASE_SERVICE_ROLE_KEY="${ph(secrets.supabaseServiceRoleKey)}"`,
    "",
    ...mediaLines,
    "",
    "# --- Transactional email (Resend) ---",
    `RESEND_API_KEY="${ph(secrets.resendApiKey)}"`,
    "",
    "# --- Site + read API + secrets ---",
    `SITE_URL="${siteUrl}"`,
    `READ_API_KEY="${ph(secrets.readApiKey)}"`,
    `WEBHOOK_SIGNING_KEY="${ph(secrets.webhookSigningKey)}"`,
    `PREVIEW_TOKEN_SECRET="${ph(secrets.previewTokenSecret)}"`,
  ];

  return `${lines.join("\n")}\n`;
}

/** Lê os secrets de `process.env` (fonte de dev/e2e; Fase 4 usa state file). */
export function secretsFromEnv(env: NodeJS.ProcessEnv): EnvSecrets {
  return {
    dbPassword: env.CMS_DB_PASSWORD,
    supabaseProjectRef: env.CMS_SUPABASE_PROJECT_REF,
    neonHost: env.CMS_NEON_HOST,
    neonDbName: env.CMS_NEON_DB_NAME,
    neonUser: env.CMS_NEON_USER,
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
    supabasePublishableKey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    bunnyStorageKey: env.BUNNY_STORAGE_KEY,
    blobReadWriteToken: env.BLOB_READ_WRITE_TOKEN,
    resendApiKey: env.RESEND_API_KEY,
    readApiKey: env.READ_API_KEY,
    webhookSigningKey: env.WEBHOOK_SIGNING_KEY,
    previewTokenSecret: env.PREVIEW_TOKEN_SECRET,
  };
}

/**
 * Gera `.env.local` no workspace-alvo (nunca commitado). NÃO sobrescreve um
 * `.env.local` existente — em dev/e2e o operador já preencheu os secrets reais e
 * clobrar com placeholders quebraria o setup local. Force com `CMS_FORCE_ENV=1`
 * (ex.: primeira geração de scaffold). Retorna o path (ou o path + marca skip).
 */
export function genEnv(config: ClientConfig, workspaceDir: string): string {
  const outPath = resolve(workspaceDir, ".env.local");
  const force = process.env.CMS_FORCE_ENV === "1";
  if (existsSync(outPath) && !force) {
    // Preserva o `.env.local` do operador; não é erro.
    return `${outPath} (preservado — já existe; CMS_FORCE_ENV=1 para regerar)`;
  }
  const secrets = secretsFromEnv(process.env);
  writeGenerated(outPath, renderEnv(config, secrets));
  return outPath;
}
