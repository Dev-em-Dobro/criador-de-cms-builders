import {
  pgTable,
  uuid,
  text,
  jsonb,
  integer,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { contentTypeEnum, contentStatusEnum } from "./enums";
import { profiles } from "./profiles";

/**
 * Base table for every content type. Type-specific fields live in `data` (JSONB,
 * validated by the per-type Zod schema in lib/content). Facets that the read API
 * must filter on are promoted to first-class columns (see caseStudyFacets).
 */
export const contentEntries = pgTable(
  "content_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    type: contentTypeEnum("type").notNull(),
    slug: text("slug").notNull(),
    locale: text("locale").notNull().default("en"),
    // Groups locale variants of the same logical entry (multilingual-ready).
    translationGroupId: uuid("translation_group_id").notNull().defaultRandom(),
    status: contentStatusEnum("status").notNull().default("draft"),
    // Editorial sort position within a type (drag-and-drop ordering). Shared
    // across the locale variants of one logical entry so the order is stable
    // regardless of which locale the public read API is serving.
    sortOrder: integer("sort_order").notNull().default(0),
    // Pointer to the live version snapshot (no FK to avoid a circular constraint).
    currentVersionId: uuid("current_version_id"),
    data: jsonb("data")
      .notNull()
      .$type<Record<string, unknown>>()
      .default(sql`'{}'::jsonb`),
    // Frozen public snapshot. NULL until first publish. The public read API
    // serves THIS, not `data`, so editing a published entry never changes the
    // live site until the author re-publishes.
    publishedData: jsonb("published_data").$type<Record<string, unknown>>(),
    // True when `data` (working copy) has edits not yet copied into
    // `publishedData`. Drives the "Publish changes" button and the badge.
    hasUnpublishedChanges: boolean("has_unpublished_changes")
      .notNull()
      .default(false),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
    updatedBy: uuid("updated_by").references(() => profiles.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("content_type_slug_locale_uq").on(t.type, t.slug, t.locale),
    index("content_type_status_locale_idx").on(t.type, t.status, t.locale),
    index("content_translation_group_idx").on(t.translationGroupId),
    index("content_type_sort_idx").on(t.type, t.sortOrder),
  ],
);

/** Append-only version history. Every save/publish writes one row. */
export const contentVersions = pgTable("content_versions", {
  id: uuid("id").defaultRandom().primaryKey(),
  entryId: uuid("entry_id")
    .notNull()
    .references(() => contentEntries.id, { onDelete: "cascade" }),
  data: jsonb("data").notNull().$type<Record<string, unknown>>(),
  statusAtSave: contentStatusEnum("status_at_save").notNull(),
  authorId: uuid("author_id").references(() => profiles.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// S2.5 (R3): a tabela de facets do `case` (antes `caseStudyFacets` /
// `case_study_facets`) foi GERADA por `gen-facets` como `caseFacets` /
// `case_facets` em `facets.generated.ts` — com índices GIN por coluna + rename da
// tabela via migration. O schema barrel (`index.ts`) re-exporta o gerado. O
// hardcode saiu daqui (Acoplamento #2 eliminado). Ver ADR-001 Decisão 1 / §6.5.

export type ContentEntry = typeof contentEntries.$inferSelect;
export type NewContentEntry = typeof contentEntries.$inferInsert;
export type ContentVersion = typeof contentVersions.$inferSelect;
