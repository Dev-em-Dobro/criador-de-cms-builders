// @cms-core/config — barrel de re-exports do módulo de configuração.

export type {
  FieldKind,
  FieldValidateConfig,
  FieldConfig,
  ItemFieldSpec,
  FacetConfig,
  CollectionConfig,
  UploadPolicyConfig,
  BrandingConfig,
  DomainsConfig,
  DatabaseConfig,
  AuthConfig,
  MediaProviderConfig,
  EmailProviderConfig,
  HostingProviderConfig,
  ProvidersConfig,
  LocaleEntry,
  LocalesConfig,
  SeedAdminConfig,
  SeedsConfig,
  ClientConfig,
} from "./types.js";

export {
  validateClientConfig,
  safeValidateClientConfig,
  ClientConfigValidationError,
} from "./validate.js";

// Builders (S0.3) — output estruturalmente equivalente aos literais do modelo.
// NOTA: `buildFields` público vem de `content-builders.js` (uiHidden-aware,
// ADR-003 P3). O `buildFields` de `builders.js` (S0.3, sem filtro) permanece
// para o gate de equivalência `equivalence.test.ts`, importado dali diretamente.
export type { RegistryEntry, FieldSpec } from "./builders.js";
export { buildContentTypes, buildRegistry, buildFacets } from "./builders.js";

// Named validator registry (S2.2) — escape hatch p/ regras finas (youtubeUrl,
// hexColor) resolvido a partir de `validate.custom`.
export type { NamedValidator } from "./named-validators.js";
export {
  registerNamedValidator,
  resolveNamedValidator,
  registeredValidatorNames,
} from "./named-validators.js";

// Content builders (S2.1, R1) — externalizam os MAPAS do motor de conteúdo para
// derivarem do ClientConfig (REGISTRY, SINGLETON_PAGES, SEGMENT_TO_TYPE,
// emptyData, IMAGE_POLICIES) + o esqueleto de schema Zod por kind.
export type {
  ListItem,
  ContentRegistryEntry,
  ContentTypeBehavior,
  SingletonPage,
  BuiltImagePolicy,
} from "./content-builders.js";
export {
  buildContentRegistry,
  buildFields,
  buildSingletonPages,
  buildSegmentToType,
  buildEmptyData,
  buildImagePolicies,
  buildFieldSchema,
  buildZodSchema,
  buildZodSchemas,
} from "./content-builders.js";
