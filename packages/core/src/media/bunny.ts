/**
 * Bunny.net storage + CDN client (no official SDK — plain fetch).
 * Binaries live in Bunny storage; the app stores only the delivery URL.
 *
 * `createBunnyStorage()` embrulha as duas funções na porta `MediaStorage`
 * (ver `storage.ts`). As funções soltas seguem exportadas: os scripts de seed do
 * Demo Corp as usam direto.
 */

import type { MediaStorage } from "./storage.js";

function cfg() {
  const host = process.env.BUNNY_STORAGE_HOST ?? "storage.bunnycdn.com";
  const zone = process.env.BUNNY_STORAGE_ZONE;
  const key = process.env.BUNNY_STORAGE_KEY;
  const cdn = process.env.BUNNY_CDN_URL;
  if (!zone || !key || !cdn) {
    throw new Error(
      "Bunny.net is not configured (BUNNY_STORAGE_ZONE / BUNNY_STORAGE_KEY / BUNNY_CDN_URL)",
    );
  }
  return { host, zone, key, cdn: cdn.replace(/\/$/, "") };
}

export async function uploadToBunny(
  path: string,
  body: Uint8Array,
  contentType: string,
): Promise<{ deliveryUrl: string; bunnyPath: string }> {
  const { host, zone, key, cdn } = cfg();
  const res = await fetch(`https://${host}/${zone}/${path}`, {
    method: "PUT",
    headers: { AccessKey: key, "content-type": contentType },
    body: body as BodyInit,
  });
  if (!res.ok) {
    throw new Error(`Bunny upload failed: ${res.status} ${res.statusText}`);
  }
  return { deliveryUrl: `${cdn}/${path}`, bunnyPath: path };
}

export async function deleteFromBunny(path: string): Promise<void> {
  const { host, zone, key } = cfg();
  await fetch(`https://${host}/${zone}/${path}`, {
    method: "DELETE",
    headers: { AccessKey: key },
  });
}

/** Adapter do Bunny para a porta `MediaStorage`. */
export function createBunnyStorage(): MediaStorage {
  return {
    async upload(path, body, contentType) {
      const { deliveryUrl, bunnyPath } = await uploadToBunny(
        path,
        body,
        contentType,
      );
      return { deliveryUrl, storagePath: bunnyPath };
    },
    delete: deleteFromBunny,
  };
}
