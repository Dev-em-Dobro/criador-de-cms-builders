// @cms-core/core/audit — trilha de auditoria append-only (S1.4).
//
// Extraído de clients/demo-corp/lib/audit/log.ts como factory injetável
// (`createAudit({ db, schema: { auditLog, profiles } })`). O `writeAudit`
// retornado é passado como `EngineDeps.audit` no `createEngine`. Ref: ADR-001
// Decisão 1 ("colaboradores cross-module injetados"). LÓGICA IDÊNTICA.

import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import type { EngineDb } from "../engine/di.js";
import type { auditLog as auditLogShape } from "./schema-shape.js";
import type { profiles as profilesShape } from "../engine/schema-shape.js";

export interface AuditInput {
  actorId?: string | null;
  /**
   * Snapshot do email do ator no momento da escrita. `actor_id` é `set null` na
   * deleção do usuário; sem isto a linha sobrevive mas fica anônima.
   */
  actorEmail?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface AuditQuery {
  actorId?: string;
  action?: string;
  targetType?: string;
  limit?: number;
  offset?: number;
}

export interface AuditSchema {
  auditLog: typeof auditLogShape;
  profiles: typeof profilesShape;
}

export interface AuditDeps {
  db: EngineDb;
  schema: AuditSchema;
}

export function createAudit(deps: AuditDeps) {
  const { db, schema } = deps;
  const { auditLog, profiles } = schema;

  /**
   * The single choke-point for audit writes. Every mutation and auth event
   * calls this so audit coverage is 100%.
   */
  async function writeAudit(input: AuditInput): Promise<void> {
    await db.insert(auditLog).values({
      actorId: input.actorId ?? null,
      actorEmail: input.actorEmail ?? null,
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      metadata: input.metadata ?? null,
    });
  }

  async function listAudit(q: AuditQuery = {}) {
    const conds: SQL[] = [];
    if (q.actorId) conds.push(eq(auditLog.actorId, q.actorId));
    if (q.action) conds.push(eq(auditLog.action, q.action));
    if (q.targetType) conds.push(eq(auditLog.targetType, q.targetType));
    return db
      .select({
        id: auditLog.id,
        action: auditLog.action,
        targetType: auditLog.targetType,
        targetId: auditLog.targetId,
        actorId: auditLog.actorId,
        // Prefer the actor's current email; fall back to the snapshot taken at
        // write time (which survives the user being deleted).
        actorEmail: sql<
          string | null
        >`coalesce(${auditLog.actorEmail}, ${profiles.email})`,
        metadata: auditLog.metadata,
        createdAt: auditLog.createdAt,
      })
      .from(auditLog)
      .leftJoin(profiles, eq(profiles.id, auditLog.actorId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(auditLog.createdAt))
      .limit(Math.min(q.limit ?? 100, 500))
      .offset(Math.max(0, q.offset ?? 0));
  }

  return { writeAudit, listAudit } as const;
}
