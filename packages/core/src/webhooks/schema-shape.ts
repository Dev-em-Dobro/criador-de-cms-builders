// @cms-core/core/webhooks — shape canônico da tabela `webhook_endpoints` (S1.4).

import { pgTable, uuid, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const webhookEndpoints = pgTable("webhook_endpoints", {
  id: uuid("id").defaultRandom().primaryKey(),
  url: text("url").notNull(),
  secret: text("secret").notNull(),
  active: boolean("active").notNull().default(true),
  events: text("events").array().notNull().default(sql`'{}'::text[]`),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
