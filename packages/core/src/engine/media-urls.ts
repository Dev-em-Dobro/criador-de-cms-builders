// @cms-core/core/engine — resolução de URLs de mídia para o read API (S1.3b).
//
// Extraído de clients/demo-corp/lib/content/media-urls.ts. LÓGICA IDÊNTICA.
// A maior parte é PURA (helpers de coleta/anexação de URLs); só
// `resolveMediaUrls` toca o banco, então vira factory sobre `deps`.

import { inArray } from "drizzle-orm";
import type { EngineDeps } from "./di.js";

/** Media id -> absolute delivery URL. */
export type MediaUrlMap = Map<string, string>;

type UrlRow = { deliveryUrl: string | null; storagePath: string | null };

/**
 * Absolute URL for one asset: prefer the stored `delivery_url`, else derive it
 * from `${BUNNY_CDN_URL}/${storagePath}`. Returns undefined when neither is
 * usable so the caller simply omits the field.
 *
 * O fallback por CDN só se aplica ao Bunny (linhas antigas gravadas sem
 * `delivery_url`). Nos demais provedores o upload sempre grava a URL, então ele
 * nunca dispara.
 */
export function assetDeliveryUrl(row: UrlRow): string | undefined {
  if (row.deliveryUrl) return row.deliveryUrl;
  const cdn = process.env.BUNNY_CDN_URL?.replace(/\/$/, "");
  if (cdn && row.storagePath) return `${cdn}/${row.storagePath}`;
  return undefined;
}

/** Media ids referenced by a content `data` payload. */
export function collectDataMediaIds(data: Record<string, unknown>): string[] {
  const ids: string[] = [];
  if (typeof data.coverMediaId === "string") ids.push(data.coverMediaId);
  if (typeof data.bannerMediaId === "string") ids.push(data.bannerMediaId);
  if (typeof data.photoMediaId === "string") ids.push(data.photoMediaId);
  if (typeof data.logoMediaId === "string") ids.push(data.logoMediaId);
  if (Array.isArray(data.items)) {
    for (const it of data.items as Array<Record<string, unknown>>) {
      if (it && typeof it.logoMediaId === "string") ids.push(it.logoMediaId);
    }
  }
  return ids;
}

/**
 * Return a shallow copy of a read-API list item with `coverUrl` added when its
 * `coverMediaId` resolves.
 */
export function attachListItemMediaUrl<T extends { coverMediaId?: string }>(
  item: T,
  urls: MediaUrlMap,
): T & { coverUrl?: string } {
  const url = item.coverMediaId ? urls.get(item.coverMediaId) : undefined;
  return url ? { ...item, coverUrl: url } : item;
}

/**
 * Return a shallow copy of a content `data` payload with resolved URLs added
 * alongside their id fields: `coverUrl`, `photoUrl`, and `items[].logoUrl`.
 */
export function attachDataMediaUrls(
  data: Record<string, unknown>,
  urls: MediaUrlMap,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };

  if (typeof data.coverMediaId === "string") {
    const url = urls.get(data.coverMediaId);
    if (url) out.coverUrl = url;
  }
  if (typeof data.bannerMediaId === "string") {
    const url = urls.get(data.bannerMediaId);
    if (url) out.bannerUrl = url;
  }
  if (typeof data.photoMediaId === "string") {
    const url = urls.get(data.photoMediaId);
    if (url) out.photoUrl = url;
  }
  if (typeof data.logoMediaId === "string") {
    const url = urls.get(data.logoMediaId);
    if (url) out.logoUrl = url;
  }
  if (Array.isArray(data.items)) {
    out.items = (data.items as Array<Record<string, unknown>>).map((it) => {
      if (it && typeof it.logoMediaId === "string") {
        const url = urls.get(it.logoMediaId);
        if (url) return { ...it, logoUrl: url };
      }
      return it;
    });
  }
  return out;
}

/** DB-bound part: batch-resolve a set of media ids to URLs (deduped). */
export function createMediaUrlsApi(deps: EngineDeps) {
  const { db, schema } = deps;
  const { mediaAssets } = schema;

  async function resolveMediaUrls(
    ids: Iterable<string>,
  ): Promise<MediaUrlMap> {
    const unique = [...new Set([...ids].filter(Boolean))];
    const map: MediaUrlMap = new Map();
    if (!unique.length) return map;
    const rows = await db
      .select({
        id: mediaAssets.id,
        deliveryUrl: mediaAssets.deliveryUrl,
        storagePath: mediaAssets.storagePath,
      })
      .from(mediaAssets)
      .where(inArray(mediaAssets.id, unique));
    for (const r of rows) {
      const url = assetDeliveryUrl(r);
      if (url) map.set(r.id, url);
    }
    return map;
  }

  return { resolveMediaUrls } as const;
}
