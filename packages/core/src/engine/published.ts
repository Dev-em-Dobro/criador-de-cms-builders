// @cms-core/core/engine — read API pública (S1.3b).
//
// Extraído de clients/demo-corp/lib/content/published.ts. LÓGICA IDÊNTICA —
// `db`→deps.db, tabelas→deps.schema.*, e o `type === "case"` de facets →
// deps.facets (extract/read/listFiltered/filter). Ref: ADR-001 Decisão 1.

import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type { EngineInternalDeps } from "./di.js";
import {
  createMediaUrlsApi,
  collectDataMediaIds,
  attachDataMediaUrls,
  attachListItemMediaUrl,
} from "./media-urls.js";

const DEFAULT_LOCALE = "en";

export interface ListParams {
  locale?: string;
  page?: number;
  pageSize?: number;
  /** Filter to entries carrying ANY of these tags (FR-817). */
  tags?: string[];
}

export interface CaseFilter extends ListParams {
  industry?: string[];
  service?: string[];
  region?: string[]; // region slugs
  outcome?: string[];
}

export function createPublishedApi(deps: EngineInternalDeps) {
  const { db, schema, facets, defForType } = deps;
  const { contentEntries } = schema;
  const { resolveMediaUrls } = createMediaUrlsApi(deps);

  /**
   * SQL predicate: the entry's `data.tags` JSONB array overlaps `tags` (OR
   * semantics). Backed by jsonb_exists_any so it reads cleanly regardless of
   * driver placeholder handling.
   */
  function tagOverlap(tags: string[]) {
    return sql`jsonb_exists_any(${contentEntries.data} -> 'tags', ${tags})`;
  }

  function paging(params: ListParams) {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
    return { page, pageSize, offset: (page - 1) * pageSize };
  }

  function toListItem(
    type: string,
    e: typeof contentEntries.$inferSelect,
  ) {
    return {
      id: e.id,
      type: e.type,
      slug: e.slug,
      locale: e.locale,
      publishedAt: e.publishedAt,
      ...defForType(type).toListItem(e.publishedData ?? e.data),
    };
  }

  async function serializeEntry(
    entry: typeof contentEntries.$inferSelect,
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    let facetVals: Record<string, string[]> | undefined;
    const read = facets ? await facets.read(db, entry.type, entry.id) : null;
    if (read) facetVals = read;

    const urls = await resolveMediaUrls(collectDataMediaIds(data));
    const withUrls = attachDataMediaUrls(data, urls);

    return {
      id: entry.id,
      type: entry.type,
      slug: entry.slug,
      locale: entry.locale,
      data: facetVals ? { ...withUrls, facets: facetVals } : withUrls,
      publishedAt: entry.publishedAt,
    };
  }

  async function listPublished(type: string, params: ListParams = {}) {
    const locale = params.locale ?? DEFAULT_LOCALE;
    const { page, pageSize, offset } = paging(params);
    const conds = [
      eq(contentEntries.type, type),
      eq(contentEntries.status, "published"),
      isNull(contentEntries.deletedAt),
      eq(contentEntries.locale, locale),
    ];
    if (params.tags?.length) conds.push(tagOverlap(params.tags));
    // Ordenação drag-and-drop generalizada via def.orderable (ADR-003 §3.10),
    // substituindo o hardcoded type==="person".
    const orderBy = defForType(type).orderable
      ? [asc(contentEntries.sortOrder), desc(contentEntries.publishedAt)]
      : [desc(contentEntries.publishedAt)];
    const rows = await db
      .select()
      .from(contentEntries)
      .where(and(...conds))
      .orderBy(...orderBy)
      .limit(pageSize)
      .offset(offset);
    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(contentEntries)
      .where(and(...conds));

    const baseItems = rows.map((e) =>
      toListItem(type, e as typeof contentEntries.$inferSelect),
    );
    const urls = await resolveMediaUrls(
      baseItems.map((i) => i.coverMediaId).filter((v): v is string => !!v),
    );
    const items = baseItems.map((i) => attachListItemMediaUrl(i, urls));
    return { items, page, pageSize, total };
  }

  async function listPublishedCases(params: CaseFilter = {}) {
    const locale = params.locale ?? DEFAULT_LOCALE;
    const pg = paging(params);

    const conds = [
      eq(contentEntries.type, "case"),
      eq(contentEntries.status, "published"),
      isNull(contentEntries.deletedAt),
      eq(contentEntries.locale, locale),
    ];
    if (params.tags?.length) conds.push(tagOverlap(params.tags));

    // The join + arrayOverlaps + count is facet-shaped — delegated to the
    // injected FacetPort so the core stays generic (byte-identical to the
    // hand-written case_study_facets behaviour on Demo Corp).
    const facetParams: Record<string, string[]> = {};
    if (params.industry?.length) facetParams.industry = params.industry;
    if (params.service?.length) facetParams.service = params.service;
    if (params.region?.length) facetParams.region = params.region;
    if (params.outcome?.length) facetParams.outcome = params.outcome;

    const result = facets
      ? await facets.listFiltered(db, "case", conds, facetParams, pg)
      : null;
    const rows = result?.rows ?? [];
    const total = result?.total ?? 0;

    const baseItems = rows.map((r) => ({
      ...toListItem(
        "case",
        r.entry as unknown as typeof contentEntries.$inferSelect,
      ),
      facets: r.facets,
    }));
    const urls = await resolveMediaUrls(
      baseItems.map((i) => i.coverMediaId).filter((v): v is string => !!v),
    );
    const items = baseItems.map((i) => attachListItemMediaUrl(i, urls));
    return { items, page: pg.page, pageSize: pg.pageSize, total };
  }

  async function getPublished(
    type: string,
    slug: string,
    locale = DEFAULT_LOCALE,
  ): Promise<Record<string, unknown> | null> {
    const fetchOne = async (loc: string) => {
      const [e] = await db
        .select()
        .from(contentEntries)
        .where(
          and(
            eq(contentEntries.type, type),
            eq(contentEntries.slug, slug),
            eq(contentEntries.locale, loc),
            eq(contentEntries.status, "published"),
            isNull(contentEntries.deletedAt),
          ),
        );
      return (e ?? null) as typeof contentEntries.$inferSelect | null;
    };

    let entry = await fetchOne(locale);
    let localeFallback = false;
    if (!entry && locale !== DEFAULT_LOCALE) {
      entry = await fetchOne(DEFAULT_LOCALE);
      localeFallback = entry != null;
    }
    if (!entry) return null;

    const serialized = await serializeEntry(
      entry,
      entry.publishedData ?? entry.data,
    );
    return { ...serialized, requestedLocale: locale, localeFallback };
  }

  return {
    serializeEntry,
    listPublished,
    listPublishedCases,
    getPublished,
  } as const;
}
