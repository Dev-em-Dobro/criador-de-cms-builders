// @cms-core/core/i18n — shape canônico da tabela `locales` do núcleo (S1.4).

import { pgTable, text, boolean, integer, timestamp } from "drizzle-orm/pg-core";

export const locales = pgTable("locales", {
  code: text("code").primaryKey(),
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

/** Row do registro de locale (o que os helpers puros e a factory consomem). */
export type Locale = typeof locales.$inferSelect;
