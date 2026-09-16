// @cms-core/media — barrel de re-exports do módulo de mídia (Bunny.net + sharp).
//
// Extraído de clients/demo-corp/lib/media/ em S1.3 (§5.5 do doc de
// arquitetura). Pipeline de upload/processamento de imagem + políticas de
// upload (IMAGE_POLICIES). Sem acoplamento ao banco do cliente.

// Armazenamento plugável: a porta + o resolvedor por provedor. Os adapters são
// carregados sob demanda (import dinâmico dentro de `createMediaStorage`), então
// quem usa Bunny não puxa o SDK da Vercel e vice-versa.
export {
  createMediaStorage,
  type MediaStorage,
  type MediaStorageDeps,
  type StoredFile,
  type MediaProviderKind,
  type BlobSdk,
} from "./storage.js";
export { uploadToBunny, deleteFromBunny, createBunnyStorage } from "./bunny.js";
export { processImage, type ProcessedUpload } from "./image.js";
export { readImageFacts } from "./image-facts.js";
export {
  IMAGE_POLICIES,
  getImagePolicy,
  checkImagePolicy,
  type ImagePolicy,
  type ImageFacts,
} from "./policies.js";
export {
  ALLOWED_MIME,
  ACCEPT_ATTR,
  MAX_SIZE_BYTES,
  validateUpload,
} from "./validate.js";
