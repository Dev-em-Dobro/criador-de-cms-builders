// clients/demo-corp/lib/core-runtime.ts
//
// Instancia o motor do core (@cms-core/core) com o `db`+schema LOCAIS deste
// cliente + o FacetPort GERADO (S2.5) a partir de `client.config.ts` — o FacetPort
// escrito à mão da Fase 1 (byte-idêntico a `case_facets`) foi substituído pelo
// gerado. Ref: ADR-001 Decisão 1 ("cada workspace-cliente ganha um
// `lib/core-runtime.ts` fino que instancia as factories").
//
// Os call-sites que antes importavam de `@/lib/content/entries`,
// `@/lib/content/published`, `@/lib/content/media-urls`, `@/lib/users/service`,
// `@/lib/auth/guards`, `@/lib/auth/session` e `@/lib/supabase/*` passam a
// importar deste arquivo (as funções são re-exportadas com o mesmo nome).
//
// Na Fase 2, `gen-facets` (S2.5) GERA o FacetPort a partir de `client.config.ts`;
// o core nunca muda — só a origem da implementação injetada.

import { cache } from "react";
import {
  createEngine,
  createUsersApi,
  TO_LIST_ITEM,
  titleSummary,
  type ListItem,
  type EngineDb,
  type EngineSchema,
  type RegistryBundle,
  type ContentTypeDef,
} from "@cms-core/core/engine";
import type { SupabaseAdminFactory } from "@cms-core/core/engine";
import {
  buildContentRegistry,
  buildImagePolicies,
  type ContentTypeBehavior,
} from "@cms-core/core/config";
import type { ImagePolicy } from "@cms-core/core/media";
// Roteamento GERADO de client.config.ts (S2.3, gen-content-types). O core-runtime
// consome o artefato gerado (não os builders) ao montar o bundle — AC5 de S2.3.
// Os valores são byte-idênticos ao que os builders produzem.
import {
  CONTENT_TYPES as GEN_CONTENT_TYPES,
  SEGMENT_TO_TYPE as GEN_SEGMENT_TO_TYPE,
  SINGLETON_PAGES as GEN_SINGLETON_PAGES,
} from "@/lib/content/content-types.generated";
// Schemas Zod + FIELDS/emptyData GERADOS de client.config.ts (S2.6, gen-zod /
// gen-ui-fields). Byte-idênticos ao gold (TEST-001); o core-runtime consome os
// artefatos gerados em vez de chamar os builders inline — AC1/AC2 de S2.6.
import { schemas as GEN_SCHEMAS } from "@/lib/content/schemas.generated";
import {
  FIELDS as GEN_FIELDS,
  emptyData as genEmptyData,
} from "@/lib/content/ui-fields.generated";
import { createAuthGuards } from "@cms-core/core/auth";
import { createAudit } from "@cms-core/core/audit";
import { createWebhooks } from "@cms-core/core/webhooks";
import { createLocales } from "@cms-core/core/i18n";
import clientConfig from "@/client.config";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { createClient as createSupabaseServer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
// FacetPort GERADO de client.config.ts (S2.5, gen-facets). Substitui o FacetPort
// escrito à mão da Fase 1 — funcionalmente equivalente (extract lê data.facets,
// upsert/filter/read/listFiltered sobre `case_facets`). O core nunca muda; só a
// origem da implementação injetada muda de manual para gerada (ADR-001 Decisão 1).
import { facetPort as facets } from "@/db/schema/facets.generated";

// ---------------------------------------------------------------------------
// Instâncias do motor + guards + users, ligadas ao db/schema deste cliente.
// ---------------------------------------------------------------------------

// Cast do schema local para o Port do core na FRONTEIRA de injeção. O Port
// (`EngineSchema`) declara as colunas de enum (`type`/`status`/`role`) como
// `text` porque o LITERAL do enum é variável por cliente (Fase 2 gen-enums); o
// schema real do Demo Corp usa `pgEnum` com literais concretos. Os dois
// inferem `string` em `$inferSelect` (o que importa em runtime), mas o tipo da
// tabela Drizzle difere no `columnType` (PgEnumColumn vs PgText). Este é o cast
// "falha cedo e local" previsto na ADR-001 (Decisão 1, Consequências/Risco): se
// uma coluna do NÚCLEO for renomeada/removida no cliente, o cast NÃO esconde —
// o uso de `deps.schema.*` no core quebraria o typecheck. Só a variação de
// columnType do enum é absorvida aqui.
const coreSchema = schema as unknown as EngineSchema;
const edb = db as unknown as EngineDb;

// Colaboradores injetados (S1.4): audit e webhooks agora vivem no core como
// factories. Seus retornos alimentam EngineDeps.audit/EngineDeps.webhooks.
const audit = createAudit({
  db: edb,
  schema: {
    auditLog: schema.auditLog as never,
    profiles: coreSchema.profiles,
  },
});
const webhooks = createWebhooks({
  db: edb,
  schema: { webhookEndpoints: schema.webhookEndpoints as never },
});

// ---------------------------------------------------------------------------
// RegistryBundle montado do config (ADR-002 §1). A ESTRUTURA (type/label/
// segment/singleton/orderable/roteamento) deriva do `client.config.ts` via os
// builders; os SCHEMAS Zod vêm de `buildZodSchemas` (byte-idênticos ao gold —
// provado no core, TEST-001) e os `toListItem` são os gold-standard REAIS
// injetados de `@cms-core/core/engine` (NÃO recodificados — MUST-DO @po). Este é
// o ponto único onde o config vira o REGISTRY do motor.
// ---------------------------------------------------------------------------

const behaviors: Record<string, ContentTypeBehavior> = Object.fromEntries(
  clientConfig.collections.map((c) => [
    c.type,
    {
      // schema do artefato GERADO (S2.6, gen-zod). `buildZodSchemas(config)` é
      // byte-idêntico aos 9 schemas gold (TEST-001) — o core-runtime consome o
      // gerado em vez de `SCHEMAS` do engine. Cast na fronteira: o gerado tipa
      // `ZodTypeAny` (output `unknown`); o behavior espera `ZodType<Record<...>>`.
      // O parse valida `data` (JSONB) que É `Record<string, unknown>` por
      // construção — a variação de tipo do output do Zod é absorvida aqui.
      schema: GEN_SCHEMAS[c.type] as ContentTypeBehavior["schema"],
      // toListItem gold-standard real por tipo; default = titleSummary.
      toListItem: (TO_LIST_ITEM[c.type] ?? titleSummary) as (
        d: Record<string, unknown>,
      ) => ListItem,
    },
  ]),
);

const registryBundle: RegistryBundle = {
  registry: buildContentRegistry(
    clientConfig,
    behaviors,
  ) as unknown as RegistryBundle["registry"],
  // roteamento vem do artefato GERADO (S2.3 AC5) — byte-idêntico aos builders.
  contentTypes: GEN_CONTENT_TYPES,
  segmentToType: GEN_SEGMENT_TO_TYPE,
  singletonPages: GEN_SINGLETON_PAGES,
};

const engine = createEngine({
  db: edb,
  schema: coreSchema,
  audit,
  webhooks,
  facets,
  registry: registryBundle,
});

const authGuards = createAuthGuards({
  db: edb,
  schema: { profiles: coreSchema.profiles },
  supabase: createSupabaseServer,
  cache,
});

const users = createUsersApi({
  db: edb,
  schema: { profiles: coreSchema.profiles },
  supabaseAdmin: createAdminClient as unknown as SupabaseAdminFactory,
});

// i18n (S1.4): locales é DB-coupled E depende de writeAudit (Should-Fix @po) —
// costuramos o colaborador `audit` do core na factory de locales.
const localesApi = createLocales({
  db: edb,
  schema: {
    locales: schema.locales as never,
    contentEntries: coreSchema.contentEntries,
  },
  audit,
  cache,
});

// ---------------------------------------------------------------------------
// Re-exports com os MESMOS nomes que os módulos originais expunham, para os
// call-sites trocarem só o caminho do import.
// ---------------------------------------------------------------------------

// engine/entries
export const listEntries = engine.listEntries;
export const getEntry = engine.getEntry;
export const createEntry = engine.createEntry;
export const updateEntry = engine.updateEntry;
export const publishEntry = engine.publishEntry;
export const unpublishEntry = engine.unpublishEntry;
export const deleteEntry = engine.deleteEntry;
export const reorderEntries = engine.reorderEntries;
export const addTranslation = engine.addTranslation;
export const listTranslations = engine.listTranslations;
export const listVersions = engine.listVersions;
export const restoreVersion = engine.restoreVersion;

// engine/published (read API)
export const serializeEntry = engine.serializeEntry;
export const listPublished = engine.listPublished;
export const listPublishedCases = engine.listPublishedCases;
export const getPublished = engine.getPublished;

// ---------------------------------------------------------------------------
// REGISTRY + roteamento + FIELDS/emptyData (ADR-002 §1 / S2.1 T6-T7).
//
// Os ~20 call-sites que importavam `validateContent`/`defForType`/
// `resolveTypeParam`/`REGISTRY`/`SEGMENT_TO_TYPE`/`SINGLETON_PAGES`/`FIELDS`/
// `emptyData`/`CONTENT_TYPES` de `@cms-core/core/engine` passam a importar deste
// arquivo — assinatura idêntica, só o path muda. O REGISTRY agora deriva do
// config (via createEngine), não é mais um singleton estático do motor.
// ---------------------------------------------------------------------------

export const validateContent = engine.validateContent;
export const defForType = engine.defForType;
export const resolveTypeParam = engine.resolveTypeParam;
export const CONTENT_TYPES = registryBundle.contentTypes;
export const SEGMENT_TO_TYPE = registryBundle.segmentToType;
export const SINGLETON_PAGES = registryBundle.singletonPages;
export const REGISTRY: Record<string, ContentTypeDef> = registryBundle.registry;

/** ContentType derivado do config (union literal — mesmo que o enum gerado). */
export type ContentType = (typeof CONTENT_TYPES)[number];

export function isContentType(v: string): v is ContentType {
  return (CONTENT_TYPES as readonly string[]).includes(v);
}

// Nomes dos facets declarados por tipo no config (S2.5 T5.3, AC9). O read API
// itera estes nomes em vez de colunas fixas — `case` continua com industry/
// service/region/outcome, mas dirigido por `def.facets[].name` do config, não por
// um hardcode. Uma nova coleção com facets ganha o parsing automaticamente.
const FACET_NAMES_BY_TYPE: Record<string, string[]> = Object.fromEntries(
  clientConfig.collections
    .filter((c) => c.facets && c.facets.length > 0)
    .map((c) => [c.type, c.facets!.map((f) => f.name)]),
);
export function facetNamesFor(type: string): string[] {
  return FACET_NAMES_BY_TYPE[type] ?? [];
}

// FIELDS / emptyData: consumidos do artefato GERADO (S2.6, gen-ui-fields) em vez
// de chamar os builders inline. O gerado faz runtime-call a buildFields/
// buildEmptyData (filtram `uiHidden`) — byte-idênticos ao `engine/ui-fields.ts`
// gold (TEST-001).
export const FIELDS = GEN_FIELDS;
export function emptyData(type: string): Record<string, unknown> {
  return genEmptyData(type);
}

// IMAGE_POLICIES / getImagePolicy derivados do config (S2.1 T8, AC4). O
// `buildImagePolicies` casa 1:1 com `UploadPolicyConfig` e é byte-idêntico ao
// `IMAGE_POLICIES` gold (provado no core, TEST-001). O `getImagePolicy` genérico
// de `@cms-core/core/media` lê o mapa estático; aqui o cliente usa o derivado.
export const IMAGE_POLICIES: Record<string, ImagePolicy> =
  buildImagePolicies(clientConfig);
export function getImagePolicy(
  field: string | null | undefined,
): ImagePolicy | null {
  if (!field) return null;
  return IMAGE_POLICIES[field] ?? null;
}

// users
export const listUsers = users.listUsers;
export const inviteUser = users.inviteUser;
export const updateUser = users.updateUser;
export const resetMfa = users.resetMfa;
export const deleteUser = users.deleteUser;

// auth guards
export const requireSession = authGuards.requireSession;
export const requireAdmin = authGuards.requireAdmin;
export const requireEnrolmentBootstrap = authGuards.requireEnrolmentBootstrap;
export const currentUser = authGuards.currentUser;
export const currentAssurance = authGuards.currentAssurance;

// i18n / locales (S1.4)
export const getLocales = localesApi.getLocales;
export const activeLocales = localesApi.activeLocales;
export const getDefaultLocale = localesApi.getDefaultLocale;
export const resolveLocale = localesApi.resolveLocale;
export const createLocale = localesApi.createLocale;
export const updateLocale = localesApi.updateLocale;
export const setDefaultLocale = localesApi.setDefaultLocale;
export const setLocaleEnabled = localesApi.setLocaleEnabled;
export const localeInUse = localesApi.localeInUse;
export const deleteLocale = localesApi.deleteLocale;

// Colaboradores injetados re-exportados p/ call-sites diretos (audit/webhooks).
export const writeAudit = audit.writeAudit;
export const listAudit = audit.listAudit;
export const dispatchRevalidation = webhooks.dispatchRevalidation;
