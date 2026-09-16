import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Contact-form leads captured from the marketing site.
 *
 * The site never touches the database directly; it POSTs to `/api/leads` with
 * the read API key and the CMS writes the row. Keeping the write here means the
 * site only needs `CMS_URL` + the key it already holds (no service-role key).
 */
export const leads = pgTable("leads", {
  id: uuid("id").defaultRandom().primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  organisation: text("organisation"),
  message: text("message").notNull(),
  source: text("source"),
  referer: text("referer"),
  userAgent: text("user_agent"),
});

export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
