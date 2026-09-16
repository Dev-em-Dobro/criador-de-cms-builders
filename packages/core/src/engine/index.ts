// @cms-core/engine — barrel de re-exports do módulo de motor de conteúdo.
//
// Extraído de clients/demo-corp/lib/content/ em S1.3 (§5.5 do doc de
// arquitetura). Nesta fatia entram os utilitários PUROS do motor (sem
// acoplamento ao banco do cliente): registry de tipos + schemas Zod, campos de
// UI, sanitização de rich-text, slug, autosave e validação de YouTube.
//
// NÃO extraídos nesta story (dependem do `db`/schema do cliente — pendente do
// redesign de injeção de dependência): entries.ts (CRUD/publish), published.ts
// (read API), media-urls.ts (resolução de URLs via query). Ver Dev Agent Record
// da S1.3.

export * from "./types.js";
export * from "./ui-fields.js";
export * from "./sanitize.js";
export * from "./slug.js";
export * from "./autosave.js";
export * from "./youtube.js";

// Contrato de injeção `db`+schema (ADR-001, Decisão 1 — S1.3a). Declara o Port
// `EngineSchema`, o `FacetPort`, os colaboradores `audit`/`webhooks`, `EngineDeps`
// e a factory `createEngine` (corpo real em S1.3b).
export * from "./di.js";
export * as schemaShape from "./schema-shape.js";

// Implementações extraídas (S1.3b). Módulos DB-coupled como factories sobre
// `deps`. As funções puras de media-urls são exportadas diretamente.
export { createEntriesApi, type ServiceResult } from "./entries.js";
export {
  createPublishedApi,
  type ListParams,
  type CaseFilter,
} from "./published.js";
export {
  createMediaUrlsApi,
  assetDeliveryUrl,
  collectDataMediaIds,
  attachDataMediaUrls,
  attachListItemMediaUrl,
  type MediaUrlMap,
} from "./media-urls.js";
export {
  createUsersApi,
  type UsersDeps,
  type SupabaseAdminApi,
  type SupabaseAdminFactory,
  type InviteUserInput,
  type UpdateUserInput,
} from "./users.js";
export {
  ConflictError,
  NotFoundError,
  AuthError,
  type AuthNext,
} from "./errors.js";
