import { pgTable, uuid, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { profiles } from "./profiles";

/** Append-only audit trail. Written through lib/audit on every mutation. */
export const auditLog = pgTable("audit_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  /**
   * `set null`, not `cascade`. Supabase's documented pattern cascades deletes
   * from auth.users through the whole graph, which would erase a deleted
   * user's audit history — the opposite of what an audit trail is for.
   */
  actorId: uuid("actor_id").references(() => profiles.id, {
    onDelete: "set null",
  }),
  /**
   * Snapshot of the actor's email at write time. Without it, `set null` leaves
   * anonymous rows that are technically retained but useless. Deliberately
   * denormalized: an audit record is a historical fact and must not change
   * when the user later changes their email.
   */
  actorEmail: text("actor_email"),
  action: text("action").notNull(),
  targetType: text("target_type"),
  targetId: uuid("target_id"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type AuditLogEntry = typeof auditLog.$inferSelect;
export type NewAuditLogEntry = typeof auditLog.$inferInsert;
