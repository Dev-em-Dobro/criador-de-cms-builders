// @cms-core/core/audit — shape canônico da tabela `audit_log` do núcleo (S1.4).
// Colunas estáveis entre clientes. Fonte estrutural do Port `AuditSchema`.

import { pgTable, uuid, text, jsonb, timestamp } from "drizzle-orm/pg-core";

export const auditLog = pgTable("audit_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  actorId: uuid("actor_id"),
  actorEmail: text("actor_email"),
  action: text("action").notNull(),
  targetType: text("target_type"),
  targetId: uuid("target_id"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
