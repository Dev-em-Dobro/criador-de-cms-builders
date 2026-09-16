/**
 * Porta de armazenamento de mídia — o binário sai daqui para algum provedor e
 * o app guarda apenas a URL de entrega.
 *
 * Por que existe: `uploadToBunny`/`deleteFromBunny` amarravam o pipeline ao
 * Bunny.net. O contrato do cliente já declarava `media.provider`, mas só havia
 * uma implementação. Esta porta é o mesmo padrão do banco plugável (D5): o
 * núcleo fala com a interface, o cliente escolhe o adapter no
 * `client.config.ts`.
 *
 * Os adapters ficam em `bunny.ts` e `vercel-blob.ts`. Nenhum deles é importado
 * de forma estática aqui — quem usa Bunny não carrega o SDK da Vercel e
 * vice-versa.
 */

/** Resultado de um upload: URL pública + caminho para exclusão futura. */
export interface StoredFile {
  /** URL de entrega (CDN) que vai para `media_assets.delivery_url`. */
  deliveryUrl: string;
  /**
   * Identificador do objeto no provedor, guardado para poder apagá-lo depois.
   * No Bunny é o caminho na storage zone; no Vercel Blob é a própria URL (é o
   * que a API `del()` aceita).
   */
  storagePath: string;
}

export interface MediaStorage {
  upload(
    path: string,
    body: Uint8Array,
    contentType: string,
  ): Promise<StoredFile>;
  /** Best-effort: falha ao apagar nunca deve derrubar a operação do usuário. */
  delete(storagePath: string): Promise<void>;
}

/** Provedores suportados (espelha `MediaProviderConfig.provider`). */
export type MediaProviderKind = "bunny" | "vercel-blob";

/** Subconjunto do SDK `@vercel/blob` que o adapter usa. */
export interface BlobSdk {
  put: (
    pathname: string,
    body: Uint8Array,
    options: Record<string, unknown>,
  ) => Promise<{ url: string }>;
  del: (
    url: string | string[],
    options?: Record<string, unknown>,
  ) => Promise<void>;
}

export interface MediaStorageDeps {
  /**
   * Carrega o SDK do Vercel Blob. Quem injeta é o WORKSPACE-CLIENTE, porque é
   * ele que tem `@vercel/blob` instalado — com pnpm, `node_modules` é isolado
   * por pacote e um `import("@vercel/blob")` executado a partir de
   * `packages/core/dist` não enxerga a dependência do cliente. Mesmo princípio
   * de injeção do resto do núcleo (ADR-001).
   */
  loadBlobSdk?: () => Promise<BlobSdk>;
}

/** Resolve o adapter pelo provedor declarado no config do cliente. */
export async function createMediaStorage(
  provider: MediaProviderKind,
  deps: MediaStorageDeps = {},
): Promise<MediaStorage> {
  switch (provider) {
    case "bunny": {
      const { createBunnyStorage } = await import("./bunny.js");
      return createBunnyStorage();
    }
    case "vercel-blob": {
      if (!deps.loadBlobSdk) {
        throw new Error(
          'Provedor "vercel-blob" exige `loadBlobSdk` — injete-o no workspace do cliente: createMediaStorage(provider, { loadBlobSdk: () => import("@vercel/blob") }).',
        );
      }
      const { createVercelBlobStorage } = await import("./vercel-blob.js");
      return createVercelBlobStorage(deps.loadBlobSdk);
    }
    default: {
      // Exaustividade checada em compilação; a mensagem cobre o runtime caso um
      // config antigo traga um provedor que este core não conhece.
      const exhaustive: never = provider;
      throw new Error(`Provedor de mídia não suportado: ${String(exhaustive)}`);
    }
  }
}
