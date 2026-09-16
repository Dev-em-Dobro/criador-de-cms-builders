// @cms-core/core/i18n — registro de idiomas administrável (S1.4).
//
// Extraído de clients/demo-corp/lib/content/locales.ts como factory
// injetável. LÓGICA IDÊNTICA — `db`→deps.db, `locales`/`contentEntries`→
// deps.schema.*, `writeAudit`→deps.audit.writeAudit (colaborador injetado,
// ABSORVE o Should-Fix do @po: locales.ts depende de writeAudit), `cache`
// (React)→deps.cache (opcional). Ref: ADR-001 Decisão 1 e Change Log v3.0.

import { count, eq } from "drizzle-orm";
import type { EngineDb } from "../engine/di.js";
import type { locales as localesShape, Locale } from "./schema-shape.js";
import type { contentEntries as contentEntriesShape } from "../engine/schema-shape.js";
import type { AuditPort } from "../engine/di.js";
import { resolveDefault, sortLocales, canDisable, canDelete } from "./locale-rules.js";

export type { Locale };

const FALLBACK_DEFAULT = "en";

export interface I18nSchema {
  locales: typeof localesShape;
  contentEntries: typeof contentEntriesShape;
}

export interface I18nDeps {
  db: EngineDb;
  schema: I18nSchema;
  /** Colaborador de auditoria injetado (Should-Fix @po). */
  audit: AuditPort;
  /** Memoização por render-pass (React `cache`). Opcional. */
  cache?: <T>(fn: () => Promise<T>) => () => Promise<T>;
}

export type ServiceResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

function identityCache<T>(fn: () => Promise<T>): () => Promise<T> {
  return fn;
}

export function createLocales(deps: I18nDeps) {
  const { db, schema, audit } = deps;
  const { locales: localesTable, contentEntries } = schema;
  const wrap = deps.cache ?? identityCache;

  // --- reads -------------------------------------------------------------

  /**
   * Memoized per request (React `cache`): the registry is read on nearly every
   * page, often several times. With this they all share one query per request.
   */
  const getLocales = wrap(async (): Promise<Locale[]> => {
    return sortLocales((await db.select().from(localesTable)) as Locale[]);
  });

  async function activeLocales(): Promise<Locale[]> {
    return (await getLocales()).filter((l) => l.enabled);
  }

  async function getDefaultLocale(): Promise<string> {
    const rows = await getLocales();
    return rows.length ? resolveDefault(rows) : FALLBACK_DEFAULT;
  }

  async function resolveLocale(
    code: string | null | undefined,
  ): Promise<string> {
    const rows = await getLocales();
    const active = rows.filter((l) => l.enabled);
    if (code && active.some((l) => l.code === code)) return code;
    return rows.length ? resolveDefault(rows) : FALLBACK_DEFAULT;
  }

  // --- mutations (admin only — callers must requireAdmin) ----------------

  async function createLocale(
    input: { code: string; label: string },
    actorId: string,
  ): Promise<ServiceResult<Locale>> {
    const code = input.code.trim();
    const label = input.label.trim();
    if (!code || !label)
      return { ok: false, error: "Code and name are required." };

    const all = (await db.select().from(localesTable)) as Locale[];
    if (all.some((l) => l.code === code))
      return { ok: false, error: "That language code already exists." };

    const [row] = await db
      .insert(localesTable)
      .values({
        code,
        label,
        isDefault: all.length === 0,
        enabled: true,
        sortOrder: all.length,
      })
      .returning();
    await audit.writeAudit({
      actorId,
      action: "locale.create",
      targetType: "locale",
      metadata: { code, label },
    });
    return { ok: true, value: row as Locale };
  }

  async function updateLocale(
    code: string,
    patch: { label?: string; sortOrder?: number },
    actorId: string,
  ): Promise<ServiceResult<Locale>> {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof patch.label === "string") set.label = patch.label.trim();
    if (typeof patch.sortOrder === "number") set.sortOrder = patch.sortOrder;
    const [row] = await db
      .update(localesTable)
      .set(set)
      .where(eq(localesTable.code, code))
      .returning();
    if (!row) return { ok: false, error: "Language not found." };
    await audit.writeAudit({
      actorId,
      action: "locale.update",
      targetType: "locale",
      metadata: { code },
    });
    return { ok: true, value: row as Locale };
  }

  async function setDefaultLocale(
    code: string,
    actorId: string,
  ): Promise<ServiceResult<Locale>> {
    const rows = (await db.select().from(localesTable)) as Locale[];
    const target = rows.find((l) => l.code === code);
    if (!target) return { ok: false, error: "Language not found." };
    if (!target.enabled)
      return {
        ok: false,
        error: "Enable the language before making it the default.",
      };

    await db.transaction(async (tx) => {
      await tx
        .update(localesTable)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(eq(localesTable.isDefault, true));
      await tx
        .update(localesTable)
        .set({ isDefault: true, updatedAt: new Date() })
        .where(eq(localesTable.code, code));
    });
    await audit.writeAudit({
      actorId,
      action: "locale.set_default",
      targetType: "locale",
      metadata: { code },
    });
    const [row] = await db
      .select()
      .from(localesTable)
      .where(eq(localesTable.code, code));
    return { ok: true, value: row as Locale };
  }

  async function setLocaleEnabled(
    code: string,
    enabled: boolean,
    actorId: string,
  ): Promise<ServiceResult<Locale>> {
    const rows = (await db.select().from(localesTable)) as Locale[];
    const target = rows.find((l) => l.code === code);
    if (!target) return { ok: false, error: "Language not found." };
    if (!enabled && !canDisable(code, rows))
      return {
        ok: false,
        error: "Set another language as the default before disabling this one.",
      };

    const [row] = await db
      .update(localesTable)
      .set({ enabled, updatedAt: new Date() })
      .where(eq(localesTable.code, code))
      .returning();
    await audit.writeAudit({
      actorId,
      action: enabled ? "locale.enable" : "locale.disable",
      targetType: "locale",
      metadata: { code },
    });
    return { ok: true, value: row as Locale };
  }

  /** How many content entries currently use this language. */
  async function localeInUse(code: string): Promise<number> {
    const [{ n }] = await db
      .select({ n: count() })
      .from(contentEntries)
      .where(eq(contentEntries.locale, code));
    return Number(n);
  }

  async function deleteLocale(
    code: string,
    actorId: string,
  ): Promise<ServiceResult<null>> {
    const rows = (await db.select().from(localesTable)) as Locale[];
    const target = rows.find((l) => l.code === code);
    if (!target) return { ok: false, error: "Language not found." };
    const inUse = await localeInUse(code);
    if (!canDelete(target, inUse)) {
      return {
        ok: false,
        error: target.isDefault
          ? "Can't delete the default language."
          : `Can't delete: ${inUse} item(s) use it. Disable it instead.`,
      };
    }
    await db.delete(localesTable).where(eq(localesTable.code, code));
    await audit.writeAudit({
      actorId,
      action: "locale.delete",
      targetType: "locale",
      metadata: { code },
    });
    return { ok: true, value: null };
  }

  return {
    getLocales,
    activeLocales,
    getDefaultLocale,
    resolveLocale,
    createLocale,
    updateLocale,
    setDefaultLocale,
    setLocaleEnabled,
    localeInUse,
    deleteLocale,
  } as const;
}
