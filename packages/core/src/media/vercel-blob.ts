/**
 * Adapter de armazenamento: Vercel Blob.
 *
 * O SDK (`@vercel/blob`) chega INJETADO pelo workspace-cliente — o core não
 * declara essa dependência, e com pnpm um import feito daqui não enxergaria o
 * `node_modules` do cliente de qualquer forma. Quem usa Bunny nunca carrega
 * este arquivo (o resolvedor em `storage.ts` importa sob demanda).
 *
 * O token vem de `BLOB_READ_WRITE_TOKEN` (a Vercel injeta a variável nos
 * deploys quando o store está ligado ao projeto; em local vai no `.env.local`).
 *
 * Diferença em relação ao Bunny que vale conhecer: aqui não existe "caminho na
 * zona" separado da URL pública — a API de exclusão recebe a própria URL. Por
 * isso `storagePath` guarda a URL, e não um caminho relativo.
 */

import type { BlobSdk, MediaStorage, StoredFile } from "./storage.js";

/** Erro de configuração com a instrução do que falta. */
function requireToken(): string {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new Error(
      "Vercel Blob não está configurado (BLOB_READ_WRITE_TOKEN ausente)",
    );
  }
  if (!token.startsWith("vercel_blob_rw_")) {
    // Erro comum: colar a URL base do store em vez do token de leitura/escrita.
    throw new Error(
      'BLOB_READ_WRITE_TOKEN não parece um token do Vercel Blob (esperado prefixo "vercel_blob_rw_").',
    );
  }
  return token;
}

export function createVercelBlobStorage(
  loadSdk: () => Promise<BlobSdk>,
): MediaStorage {
  return {
    async upload(path, body, contentType): Promise<StoredFile> {
      const token = requireToken();
      const { put } = await loadSdk();
      const blob = await put(path, body, {
        access: "public",
        contentType,
        token,
        /**
         * O caminho já carrega um UUID gerado pelo chamador, então o sufixo
         * aleatório do SDK só sujaria a URL. Desligado de propósito: com ele
         * ligado, a URL final difere do caminho pedido.
         */
        addRandomSuffix: false,
      });
      return { deliveryUrl: blob.url, storagePath: blob.url };
    },

    async delete(storagePath): Promise<void> {
      const token = requireToken();
      const { del } = await loadSdk();
      await del(storagePath, { token });
    },
  };
}
