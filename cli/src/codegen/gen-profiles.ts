// @cms-core/cli — gen-profiles (S5.3, D5 / §13.4).
//
// ÚNICO gerador de schema consciente de `database.kind` (junto do gen-env, que é
// consciente só para as connection strings). Emite `db/schema/profiles.generated.ts`
// com a tabela `profiles`, cujas COLUNAS são IDÊNTICAS entre providers; muda só a
// presença da FK `profiles_id_auth_users_fk` → `authUsers.id` (`drizzle-orm/supabase`):
//
//   • database.kind === "supabase": emite `profiles` COM o import `authUsers` e o
//     bloco `foreignKey({ columns:[id], foreignColumns:[authUsers.id] }).onDelete("cascade")`.
//     Byte-idêntico (em estrutura) ao `profiles.ts` gold-standard.
//   • database.kind === "neon": emite `profiles` SEM o import `authUsers` e SEM o
//     bloco `foreignKey(...)`. `profiles.id` vira um UUID espelhado do
//     `auth.users.id` do Supabase auth-only, sem FK enforced (não há FK cross-database
//     no Postgres, nem é preciso — §13.4). As colunas continuam idênticas.
//
// A FK LOCAL `content_entries.createdBy/updatedBy → profiles.id` (db/schema/content.ts)
// permanece nos DOIS casos — é intra-banco e independe deste gerador.
//
// Determinismo (ADR-003 §7.3): header fixo, sem data/hash; colunas na ordem canônica.

import { resolve } from "node:path";
import type { ClientConfig } from "@cms-core/core/config";
import { GENERATED_HEADER, writeGenerated } from "./shared.js";

/** Doc-comment canônico da tabela `profiles` (idêntico ao gold-standard). */
const PROFILES_DOC = `/**
 * Application-side user record. Credentials, email confirmation, MFA factors
 * and sessions all live in Supabase's \`auth.users\` — this table owns only what
 * the CMS itself needs.
 *
 * Named \`profiles\` rather than \`users\` deliberately: it matches Supabase's
 * documented pattern, and it sidesteps a reported \`search_path\` collision
 * where the auth service resolves an unqualified \`users\` to \`public.users\`.
 *
 * \`id\` IS the auth.users UUID — not a separate key with a reference column.
 * That keeps a single source of truth and makes any future RLS policy a plain
 * \`auth.uid() = id\`.
 *
 * RLS is ENABLED on this table (migration 0001) with no policies. The app
 * reaches it only through Drizzle as the owning \`postgres\` role, which bypasses
 * RLS; anon/authenticated (PostgREST, public key) are denied. Do NOT add a
 * permissive policy here without deliberately intending to expose the table
 * over the public REST API — that is exactly the hole 0001 closed.
 *
 * \`role\` and \`status\` are read on every guarded request rather than carried in
 * the JWT. Supabase cannot revoke a live access token, so a JWT-borne role or
 * status would stay stale for up to a full token lifetime after an admin
 * demotes or disables someone.
 */`;

/** Nota (só no caso Neon) explicando a ausência da FK cross-database (§13.4). */
const NEON_FK_NOTE = `// (D5 / §13.4) database=neon: \`profiles.id\` é um UUID ESPELHADO do
// \`auth.users.id\` do Supabase auth-only — sem FK enforced, porque \`auth.users\`
// vive em OUTRO banco (não há FK cross-database no Postgres, nem é preciso). A
// ponte entre provedores é o VALOR do UUID (\`claims.sub == profiles.id\`,
// lib/auth/guards.ts), não uma constraint. A FK LOCAL
// \`content_entries.createdBy → profiles.id\` permanece intacta (intra-Neon).`;

/** Bloco de colunas — IDÊNTICO entre providers (o coração da equivalência D5). */
const PROFILES_COLUMNS = `    id: uuid("id").primaryKey(),
    email: text("email").notNull().unique(),
    role: roleEnum("role").notNull().default("editor"),
    status: userStatusEnum("status").notNull().default("invited"),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),`;

/**
 * Renderiza o conteúdo de `profiles.generated.ts` para o provider do config
 * (função pura — testável). O import `authUsers` e o 2º argumento (extraConfig
 * com o bloco `foreignKey`) do `pgTable` só existem no caso Supabase.
 */
export function renderProfiles(config: ClientConfig): string {
  const isSupabase = config.providers.database.kind === "supabase";

  const authImport = isSupabase
    ? `import { authUsers } from "drizzle-orm/supabase";\n`
    : "";

  const providerNote = isSupabase ? "" : `\n${NEON_FK_NOTE}\n`;

  // O caso Supabase passa um 2º argumento ao pgTable com a FK; o caso Neon usa a
  // forma de 1 argumento (só as colunas). O drizzle-kit vê colunas idênticas nos
  // dois; muda só a constraint gerada na migration.
  const tableBody = isSupabase
    ? `export const profiles = pgTable(
  "profiles",
  {
${PROFILES_COLUMNS}
  },
  (t) => [
    foreignKey({
      columns: [t.id],
      foreignColumns: [authUsers.id],
      name: "profiles_id_auth_users_fk",
    }).onDelete("cascade"),
  ],
);`
    : `export const profiles = pgTable("profiles", {
${PROFILES_COLUMNS}
});`;

  // O import de `foreignKey` só é necessário no caso Supabase.
  const pgCoreImport = isSupabase
    ? `import { pgTable, uuid, text, timestamp, foreignKey } from "drizzle-orm/pg-core";`
    : `import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";`;

  const fkSummary = isSupabase
    ? "a FK `profiles_id_auth_users_fk` → auth.users está PRESENTE"
    : "a FK auth.users→profiles é OMITIDA (UUID espelhado sem FK)";

  return `${GENERATED_HEADER}
// Tabela \`profiles\` derivada de client.config.ts (S5.3, D5 / §13.4). Colunas
// IDÊNTICAS entre providers; database=${config.providers.database.kind}: ${fkSummary}.
${pgCoreImport}
${authImport}import { roleEnum, userStatusEnum } from "./enums";
${providerNote}
${PROFILES_DOC}
${tableBody}

export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;
`;
}

/** Gera `db/schema/profiles.generated.ts` no workspace-alvo. */
export function genProfiles(config: ClientConfig, workspaceDir: string): string {
  const outPath = resolve(workspaceDir, "db/schema/profiles.generated.ts");
  writeGenerated(outPath, renderProfiles(config));
  return outPath;
}
