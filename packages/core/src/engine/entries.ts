// @cms-core/core/engine — CRUD/publish do motor de conteúdo (S1.3b).
//
// Extraído de clients/demo-corp/lib/content/entries.ts. LÓGICA IDÊNTICA —
// só a origem das deps muda: `db` → deps.db, tabelas concretas → deps.schema.*,
// `writeAudit` → deps.audit.writeAudit, `dispatchRevalidation` →
// deps.webhooks.dispatchRevalidation, e o `type === "case"` de facets →
// deps.facets?.extract/upsert (injetável). Ref: ADR-001 Decisão 1.
//
// As funções são fábricas fechadas sobre `deps` (via `createEntriesApi(deps)`),
// consumidas por `createEngine` em `di.ts`.

import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { sanitizeRichText } from "./sanitize.js";
import { slugify } from "./slug.js";
import type { EngineInternalDeps } from "./di.js";
import { ConflictError, NotFoundError } from "./errors.js";

/** Row inferido da tabela `content_entries` do núcleo. */
type ContentEntry = EngineInternalDeps["schema"]["contentEntries"]["$inferSelect"];

export type ServiceResult<T> =
  | { ok: true; entry: T }
  | { ok: false; errors: Record<string, string> };

export function createEntriesApi(deps: EngineInternalDeps) {
  const { db, schema, audit, webhooks, facets, validateContent, defForType } =
    deps;
  const { contentEntries, contentVersions, mediaAssets } = schema;

  // --- media references ---------------------------------------------------

  function collectMediaIds(
    type: string,
    data: Record<string, unknown>,
  ): string[] {
    const ids: string[] = [];
    const push = (v: unknown) => {
      if (typeof v === "string") ids.push(v);
    };
    push(data.coverMediaId);
    push(data.photoMediaId);
    push(data.bannerMediaId);
    push(data.logoMediaId);
    if (type === "page_awards" && Array.isArray(data.items)) {
      for (const it of data.items as Array<Record<string, unknown>>)
        push(it.logoMediaId);
    }
    return ids;
  }

  async function missingMediaRefs(
    type: string,
    data: Record<string, unknown>,
  ): Promise<string[]> {
    const ids = [...new Set(collectMediaIds(type, data))];
    if (!ids.length) return [];
    const rows = await db
      .select({ id: mediaAssets.id })
      .from(mediaAssets)
      .where(inArray(mediaAssets.id, ids));
    const found = new Set(rows.map((r) => r.id));
    return ids.filter((i) => !found.has(i));
  }

  // --- reads --------------------------------------------------------------

  async function listEntries(
    type: string,
    opts: {
      status?: "draft" | "published" | "archived";
      limit?: number;
      offset?: number;
      orderBy?: "updatedAt" | "sortOrder";
    } = {},
  ): Promise<ContentEntry[]> {
    const conds = [
      eq(contentEntries.type, type),
      isNull(contentEntries.deletedAt),
    ];
    if (opts.status) conds.push(eq(contentEntries.status, opts.status));
    const order =
      opts.orderBy === "sortOrder"
        ? [asc(contentEntries.sortOrder), asc(contentEntries.createdAt)]
        : [desc(contentEntries.updatedAt)];
    return db
      .select()
      .from(contentEntries)
      .where(and(...conds))
      .orderBy(...order)
      .limit(opts.limit ?? 50)
      .offset(opts.offset ?? 0) as Promise<ContentEntry[]>;
  }

  async function getEntry(
    type: string,
    id: string,
  ): Promise<ContentEntry | null> {
    const [e] = await db
      .select()
      .from(contentEntries)
      .where(
        and(
          eq(contentEntries.id, id),
          eq(contentEntries.type, type),
          isNull(contentEntries.deletedAt),
        ),
      );
    return (e ?? null) as ContentEntry | null;
  }

  // --- writes -------------------------------------------------------------

  function deriveTitle(
    type: string,
    data: Record<string, unknown>,
  ): string {
    return defForType(type).toListItem(data).title;
  }

  async function createEntry(
    type: string,
    input: {
      data: unknown;
      locale?: string;
      slug?: string;
      translationGroupId?: string;
      actorId: string;
    },
  ): Promise<ServiceResult<ContentEntry>> {
    const v = validateContent(type, input.data);
    if (!v.ok) return { ok: false, errors: v.errors! };
    const data = sanitizeRichText(type, v.data!);
    const locale = input.locale ?? "en";
    const slug = (
      input.slug?.trim() || slugify(deriveTitle(type, data))
    ).toLowerCase();

    const entry = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(contentEntries)
        .values({
          type,
          slug,
          locale,
          status: "draft",
          data,
          createdBy: input.actorId,
          updatedBy: input.actorId,
          ...(input.translationGroupId
            ? { translationGroupId: input.translationGroupId }
            : {}),
        })
        .returning();

      const [version] = await tx
        .insert(contentVersions)
        .values({
          entryId: created.id,
          data,
          statusAtSave: "draft",
          authorId: input.actorId,
        })
        .returning();

      const [withVersion] = await tx
        .update(contentEntries)
        .set({ currentVersionId: version.id })
        .where(eq(contentEntries.id, created.id))
        .returning();

      const f = facets?.extract(type, data);
      if (f) await facets!.upsert(tx as never, type, created.id, f);
      return withVersion;
    });

    await audit.writeAudit({
      actorId: input.actorId,
      action: "entry.create",
      targetType: "entry",
      targetId: entry.id,
      metadata: { type, slug },
    });
    return { ok: true, entry: entry as ContentEntry };
  }

  async function updateEntry(
    type: string,
    id: string,
    input: { data: unknown; expectedVersionId?: string; actorId: string },
  ): Promise<ServiceResult<ContentEntry>> {
    const v = validateContent(type, input.data);
    if (!v.ok) return { ok: false, errors: v.errors! };
    const data = sanitizeRichText(type, v.data!);

    const entry = await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(contentEntries)
        .where(and(eq(contentEntries.id, id), isNull(contentEntries.deletedAt)));
      if (!current) throw new NotFoundError("Entry not found");
      if (
        input.expectedVersionId &&
        current.currentVersionId !== input.expectedVersionId
      ) {
        throw new ConflictError();
      }

      const [version] = await tx
        .insert(contentVersions)
        .values({
          entryId: id,
          data,
          statusAtSave: current.status,
          authorId: input.actorId,
        })
        .returning();

      const [updated] = await tx
        .update(contentEntries)
        .set({
          data,
          currentVersionId: version.id,
          updatedBy: input.actorId,
          updatedAt: new Date(),
          ...(current.status === "published"
            ? { hasUnpublishedChanges: true }
            : {}),
        })
        .where(eq(contentEntries.id, id))
        .returning();

      return updated;
    });

    await audit.writeAudit({
      actorId: input.actorId,
      action: "entry.update",
      targetType: "entry",
      targetId: id,
      metadata: { type },
    });
    return { ok: true, entry: entry as ContentEntry };
  }

  async function publishEntry(
    type: string,
    id: string,
    actorId: string,
  ): Promise<ServiceResult<ContentEntry>> {
    const entry = await getEntry(type, id);
    if (!entry) throw new NotFoundError("Entry not found");

    const v = validateContent(type, entry.data);
    if (!v.ok) return { ok: false, errors: v.errors! };
    const missing = await missingMediaRefs(type, entry.data);
    if (missing.length) {
      return {
        ok: false,
        errors: Object.fromEntries(
          missing.map((m) => [m, "referenced media not found"]),
        ),
      };
    }

    const now = new Date();
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(contentEntries)
        .set({
          status: "published",
          publishedData: entry.data,
          hasUnpublishedChanges: false,
          publishedAt: entry.publishedAt ?? now,
          updatedBy: actorId,
          updatedAt: now,
        })
        .where(eq(contentEntries.id, id))
        .returning();

      // Case facets are the PUBLISHED facets: refresh them from the snapshot.
      const f = facets?.extract(type, entry.data);
      if (f) await facets!.upsert(tx as never, type, id, f);
      return row;
    });

    await audit.writeAudit({
      actorId,
      action: "entry.publish",
      targetType: "entry",
      targetId: id,
      metadata: { type, slug: entry.slug },
    });
    await webhooks.dispatchRevalidation({
      event: "entry.published",
      type,
      slug: entry.slug,
      locale: entry.locale,
      at: now.toISOString(),
    });
    return { ok: true, entry: updated as ContentEntry };
  }

  async function unpublishEntry(
    type: string,
    id: string,
    actorId: string,
  ): Promise<ServiceResult<ContentEntry>> {
    const entry = await getEntry(type, id);
    if (!entry) throw new NotFoundError("Entry not found");

    const now = new Date();
    const [updated] = await db
      .update(contentEntries)
      .set({
        status: "draft",
        hasUnpublishedChanges: false,
        updatedBy: actorId,
        updatedAt: now,
      })
      .where(eq(contentEntries.id, id))
      .returning();

    await audit.writeAudit({
      actorId,
      action: "entry.unpublish",
      targetType: "entry",
      targetId: id,
      metadata: { type },
    });
    await webhooks.dispatchRevalidation({
      event: "entry.unpublished",
      type,
      slug: entry.slug,
      locale: entry.locale,
      at: now.toISOString(),
    });
    return { ok: true, entry: updated as ContentEntry };
  }

  async function deleteEntry(
    type: string,
    id: string,
    actorId: string,
  ): Promise<void> {
    const entry = await getEntry(type, id);
    if (!entry) throw new NotFoundError("Entry not found");

    const variants = await db
      .select()
      .from(contentEntries)
      .where(
        and(
          eq(contentEntries.translationGroupId, entry.translationGroupId),
          isNull(contentEntries.deletedAt),
        ),
      );

    const now = new Date();
    await db
      .update(contentEntries)
      .set({ deletedAt: now, updatedBy: actorId, updatedAt: now })
      .where(
        and(
          eq(contentEntries.translationGroupId, entry.translationGroupId),
          isNull(contentEntries.deletedAt),
        ),
      );

    await audit.writeAudit({
      actorId,
      action: "entry.delete",
      targetType: "entry",
      targetId: entry.translationGroupId,
      metadata: { type, variantIds: variants.map((v) => v.id) },
    });

    await Promise.all(
      variants
        .filter((v) => v.status === "published")
        .map((v) =>
          webhooks.dispatchRevalidation({
            event: "entry.unpublished",
            type,
            slug: v.slug,
            locale: v.locale,
            at: now.toISOString(),
          }),
        ),
    );
  }

  async function reorderEntries(
    type: string,
    orderedGroupIds: string[],
    actorId: string,
  ): Promise<void> {
    await db.transaction(async (tx) => {
      for (let i = 0; i < orderedGroupIds.length; i++) {
        await tx
          .update(contentEntries)
          .set({ sortOrder: i, updatedBy: actorId })
          .where(
            and(
              eq(contentEntries.type, type),
              eq(contentEntries.translationGroupId, orderedGroupIds[i]),
              isNull(contentEntries.deletedAt),
            ),
          );
      }
    });

    await audit.writeAudit({
      actorId,
      action: "entry.reorder",
      targetType: "entry",
      metadata: { type, order: orderedGroupIds },
    });
  }

  // --- translations -------------------------------------------------------

  async function addTranslation(
    type: string,
    id: string,
    locale: string,
    actorId: string,
  ): Promise<ServiceResult<ContentEntry>> {
    const source = await getEntry(type, id);
    if (!source) throw new NotFoundError("Entry not found");

    const [existing] = await db
      .select()
      .from(contentEntries)
      .where(
        and(
          eq(contentEntries.translationGroupId, source.translationGroupId),
          eq(contentEntries.locale, locale),
          isNull(contentEntries.deletedAt),
        ),
      );
    if (existing) {
      return {
        ok: false,
        errors: { locale: "A translation for this locale already exists" },
      };
    }

    return createEntry(type, {
      data: source.data,
      locale,
      slug: source.slug,
      translationGroupId: source.translationGroupId,
      actorId,
    });
  }

  async function listTranslations(translationGroupId: string) {
    return db
      .select({
        id: contentEntries.id,
        locale: contentEntries.locale,
        status: contentEntries.status,
      })
      .from(contentEntries)
      .where(
        and(
          eq(contentEntries.translationGroupId, translationGroupId),
          isNull(contentEntries.deletedAt),
        ),
      )
      .orderBy(contentEntries.locale);
  }

  // --- versions -----------------------------------------------------------

  async function listVersions(entryId: string) {
    return db
      .select({
        id: contentVersions.id,
        statusAtSave: contentVersions.statusAtSave,
        createdAt: contentVersions.createdAt,
        authorEmail: schema.profiles.email,
      })
      .from(contentVersions)
      .leftJoin(
        schema.profiles,
        eq(schema.profiles.id, contentVersions.authorId),
      )
      .where(eq(contentVersions.entryId, entryId))
      .orderBy(desc(contentVersions.createdAt));
  }

  async function restoreVersion(
    type: string,
    id: string,
    versionId: string,
    actorId: string,
  ): Promise<ContentEntry> {
    const entry = await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(contentEntries)
        .where(and(eq(contentEntries.id, id), isNull(contentEntries.deletedAt)));
      if (!current) throw new NotFoundError("Entry not found");

      const [ver] = await tx
        .select()
        .from(contentVersions)
        .where(
          and(
            eq(contentVersions.id, versionId),
            eq(contentVersions.entryId, id),
          ),
        );
      if (!ver) throw new NotFoundError("Version not found");

      const [newVersion] = await tx
        .insert(contentVersions)
        .values({
          entryId: id,
          data: ver.data,
          statusAtSave: current.status,
          authorId: actorId,
        })
        .returning();

      const [updated] = await tx
        .update(contentEntries)
        .set({
          data: ver.data,
          currentVersionId: newVersion.id,
          updatedBy: actorId,
          updatedAt: new Date(),
          ...(current.status === "published"
            ? { hasUnpublishedChanges: true }
            : {}),
        })
        .where(eq(contentEntries.id, id))
        .returning();

      return updated;
    });

    await audit.writeAudit({
      actorId,
      action: "version.restore",
      targetType: "entry",
      targetId: id,
      metadata: { type, versionId },
    });
    return entry as ContentEntry;
  }

  return {
    listEntries,
    getEntry,
    createEntry,
    updateEntry,
    publishEntry,
    unpublishEntry,
    deleteEntry,
    reorderEntries,
    addTranslation,
    listTranslations,
    listVersions,
    restoreVersion,
  } as const;
}
