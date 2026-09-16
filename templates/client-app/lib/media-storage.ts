import clientConfig from "@/client.config";
import {
  createMediaStorage,
  type BlobSdk,
  type MediaStorage,
} from "@cms-core/core/media";

/**
 * Armazenamento de mídia deste cliente, resolvido a partir do
 * `client.config.ts` (`providers.media.provider`).
 *
 * Se o config usar `provider: "vercel-blob"`, instale `@vercel/blob` NESTE
 * workspace e mantenha o loader abaixo: com pnpm o `node_modules` é isolado por
 * pacote, e um import feito de dentro de `packages/core/dist` não enxergaria a
 * dependência daqui. Com `provider: "bunny"` o loader nunca é chamado.
 *
 * O adapter é memorizado como PROMISE (não valor) para que duas requisições
 * simultâneas não disparem dois imports.
 */
let cached: Promise<MediaStorage> | null = null;

export function mediaStorage(): Promise<MediaStorage> {
  cached ??= createMediaStorage(clientConfig.providers.media.provider, {
    loadBlobSdk: () => import("@vercel/blob") as unknown as Promise<BlobSdk>,
  });
  return cached;
}
