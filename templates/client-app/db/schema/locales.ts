import { pgTable, text, boolean, integer, timestamp } from "drizzle-orm/pg-core";

/**
 * Admin-managed registry of the languages the CMS offers (i18n).
 *
 * `content_entries.locale` stays free-form text; this table curates which
 * languages are offered in the admin and which one is the fallback default.
 */
export const locales = pgTable("locales", {
  code: text("code").primaryKey(), // e.g. "en", "pt-BR"
  label: text("label").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  enabled: boolean("enabled").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Locale = typeof locales.$inferSelect;
export type NewLocale = typeof locales.$inferInsert;
