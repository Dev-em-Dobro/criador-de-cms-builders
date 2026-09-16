// @cms-core/core/engine — shapes canônicos das 4 tabelas do NÚCLEO (ADR-001, Decisão 1).
//
// Este arquivo é a FONTE DE VERDADE ESTRUTURAL do Port `EngineSchema`. Declara,
// via Drizzle (`pgTable`), o shape das tabelas cujas colunas são ESTÁVEIS entre
// todos os clientes (`content_entries`, `content_versions`, `media_assets`,
// `profiles`). O `EngineSchema` (em `di.ts`) usa `typeof` destes shapes para
// preservar os tipos fortes do Drizzle (`$inferSelect`/`$inferInsert`) sem
// depender do schema concreto de um cliente específico.
//
// Como o Port é satisfeito (ADR-001 §6.5): o schema escrito à mão do Demo Corp
// (Fase 1) e o schema codegen'd (Fase 2) satisfazem este Port
// ESTRUTURALMENTE — desde que as colunas do núcleo existam no schema do cliente,
// o typecheck passa na instanciação da factory (em `lib/core-runtime.ts`). As
// tabelas VARIÁVEIS por cliente (o literal do `contentTypeEnum`, as tabelas
// `<type>_facets`) NÃO entram aqui — o filtro de facets é injetado à parte via
// `FacetPort`.
//
// NOTA sobre enums: os shapes canônicos declaram `type`/`status`/`role` como
// colunas `text` (não `pgEnum`), porque o LITERAL do enum é variável por cliente
// (Fase 2, `gen-enums`). O Port precisa apenas que a coluna exista e seja
// atribuível de/para `string`; o union forte (`ContentType`) vive na borda, no
// cliente. A atribuição estrutural de um `pgEnum` concreto do cliente a uma
// coluna `text` canônica funciona porque ambos inferem `string`.

import {
  pgTable,
  uuid,
  text,
  jsonb,
  integer,
  boolean,
  bigint,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * `content_entries` — tabela base de toda entry de conteúdo. Colunas estáveis
 * entre clientes (o que varia é o literal do enum `type`, declarado aqui como
 * `text` para o Port ser provider-agnóstico).
 */
export const contentEntries = pgTable("content_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  type: text("type").notNull(),
  slug: text("slug").notNull(),
  locale: text("locale").notNull().default("en"),
  translationGroupId: uuid("translation_group_id").notNull().defaultRandom(),
  status: text("status").notNull().default("draft"),
  sortOrder: integer("sort_order").notNull().default(0),
  currentVersionId: uuid("current_version_id"),
  data: jsonb("data").notNull().$type<Record<string, unknown>>(),
  publishedData: jsonb("published_data").$type<Record<string, unknown>>(),
  hasUnpublishedChanges: boolean("has_unpublished_changes")
    .notNull()
    .default(false),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdBy: uuid("created_by"),
  updatedBy: uuid("updated_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** `content_versions` — histórico append-only. Um row por save/publish. */
export const contentVersions = pgTable("content_versions", {
  id: uuid("id").defaultRandom().primaryKey(),
  entryId: uuid("entry_id").notNull(),
  data: jsonb("data").notNull().$type<Record<string, unknown>>(),
  statusAtSave: text("status_at_save").notNull(),
  authorId: uuid("author_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** `media_assets` — metadados de mídia (binários no Bunny.net). */
export const mediaAssets = pgTable("media_assets", {
  id: uuid("id").defaultRandom().primaryKey(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  width: integer("width"),
  height: integer("height"),
  // Coluna física mantém o nome legado `bunny_path` (renomear exigiria
  // migration); a propriedade não carrega mais o nome do provedor.
  storagePath: text("bunny_path").notNull(),
  deliveryUrl: text("delivery_url").notNull(),
  altText: text("alt_text"),
  uploadedBy: uuid("uploaded_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * `profiles` — registro de usuário do lado da aplicação. `id` É o UUID de
 * `auth.users` (Supabase). `role`/`status` declarados como `text` (variáveis por
 * cliente no literal do enum).
 */
export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull().unique(),
  role: text("role").notNull().default("editor"),
  status: text("status").notNull().default("invited"),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
