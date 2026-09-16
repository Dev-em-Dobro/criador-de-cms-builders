// @cms-core/core/engine — Contrato de injeção `db`+schema (ADR-001, Decisão 1).
//
// O core NÃO importa `db` nem tabelas concretas de um cliente. Cada módulo
// DB-coupled do motor é uma FÁBRICA (`createEngine`) que recebe, do cliente, a
// instância Drizzle e um objeto de schema que satisfaz o Port `EngineSchema`, e
// retorna as funções do motor já ligadas às deps.
//
// Assinaturas conforme ADR-001 Decisão 1 ("Escolha") e §5.6 do doc de
// arquitetura.
//
// NOTA S1.3a: este arquivo declara o CONTRATO (interfaces + assinaturas) e um
// STUB da factory. O corpo real de `createEngine` é preenchido em S1.3b,
// movendo a lógica de `entries.ts`/`published.ts`/`media-urls.ts`/`users` do
// cliente para o core.

import type { z } from "zod";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { ValidationResult } from "./types.js";
import type {
  contentEntries,
  contentVersions,
  mediaAssets,
  profiles,
} from "./schema-shape.js";

// ---------------------------------------------------------------------------
// Port do schema — o CONTRATO que o schema do cliente deve satisfazer.
// São EXATAMENTE as tabelas do núcleo (nomes/colunas estáveis entre clientes).
// As tabelas variáveis por cliente (contentTypeEnum, <type>_facets) NÃO entram
// aqui — o filtro de facets é injetado à parte via `FacetPort`.
// ---------------------------------------------------------------------------

export interface EngineSchema {
  contentEntries: typeof contentEntries;
  contentVersions: typeof contentVersions;
  mediaAssets: typeof mediaAssets;
  profiles: typeof profiles;
}

/** Drizzle db genérico sobre o schema do cliente. */
export type EngineDb = PostgresJsDatabase<Record<string, unknown>>;

// ---------------------------------------------------------------------------
// Colaboradores cross-module injetados (resolvem o acoplamento
// entries → audit/webhooks, módulos da S1.4). Chegam via `deps`, sem import
// direto de S1.4 pelo core.
// ---------------------------------------------------------------------------

export interface AuditInput {
  actorId?: string | null;
  /**
   * Snapshot do email do ator no momento da escrita. Opcional — os call-sites do
   * motor não o passam; presente no contrato para compatibilidade com a
   * implementação injetada do cliente (`writeAudit` aceita superset).
   */
  actorEmail?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface RevalidationEvent {
  event: string;
  type: string;
  slug: string;
  locale: string;
  at: string;
}

export interface AuditPort {
  writeAudit(input: AuditInput): Promise<void>;
}

export interface WebhooksPort {
  dispatchRevalidation(ev: RevalidationEvent): Promise<void>;
}

// ---------------------------------------------------------------------------
// FacetPort — generaliza o hoje-hardcoded `type === "case"` / `caseStudyFacets`.
// Na Fase 1, o cliente injeta um FacetPort escrito à mão (byte-idêntico ao
// comportamento de `case_study_facets`). Na Fase 2, `gen-facets` gera-o.
// ---------------------------------------------------------------------------

export interface FacetPort {
  /** Extrai as colunas text[] de um payload validado (hoje: extractCaseFacets). */
  extract(
    type: string,
    data: Record<string, unknown>,
  ): Record<string, string[]> | null;
  /**
   * Upsert das facets publicadas para uma entry, dentro de uma transação
   * (hoje: insert/onConflictDoUpdate em caseStudyFacets).
   */
  upsert(
    tx: EngineDb,
    type: string,
    entryId: string,
    facets: Record<string, string[]>,
  ): Promise<void>;
  /**
   * Predicados de filtro do read API por facet
   * (hoje: arrayOverlaps(caseStudyFacets.*)).
   */
  filter(type: string, params: Record<string, string[]>): unknown[];
  /**
   * Lê as facets de UMA entry publicada, no shape do read API
   * (hoje: select from caseStudyFacets → { industry, service, region, outcome }).
   * Usado por `serializeEntry`. Retorna `null` se o tipo não tem facets.
   */
  read(
    db: EngineDb,
    type: string,
    entryId: string,
  ): Promise<Record<string, string[]> | null>;
  /**
   * Biblioteca faceta paginada+filtrada (hoje: listPublishedCases — innerJoin
   * caseStudyFacets + arrayOverlaps + count). Recebe os predicados-base
   * (type/status/locale/tags) já montados pelo motor e devolve items+total.
   * Retorna `null` se o tipo não suporta biblioteca faceta.
   */
  listFiltered(
    db: EngineDb,
    type: string,
    baseConds: unknown[],
    params: Record<string, string[]>,
    paging: { page: number; pageSize: number; offset: number },
  ): Promise<{
    rows: Array<{
      entry: Record<string, unknown>;
      facets: Record<string, string[]>;
    }>;
    total: number;
  } | null>;
}

// ---------------------------------------------------------------------------
// RegistryBundle — o REGISTRY como dep injetada (ADR-002, Decisão 1).
//
// O core define o SHAPE (`ContentTypeDef`/`ContentRegistry`), mas NÃO o conteúdo
// (os 9 tipos concretos). O conteúdo é montado no cliente (`lib/core-runtime.ts`)
// a partir do `client.config.ts`, via os builders de `@cms-core/core/config`, e
// injetado aqui. `validateContent`/`defForType`/`resolveTypeParam` deixam de ser
// funções de módulo e viram métodos fechados sobre `deps.registry` (sem estado
// de módulo mutável, sem ordenação de import). Ver ADR-002 §1.
// ---------------------------------------------------------------------------

export interface ContentListItem {
  title: string;
  summary?: string;
  coverMediaId?: string;
  tags?: string[];
}

export interface ContentTypeDef {
  type: string;
  label: string;
  /** segmento plural p/ coleções; undefined p/ singletons. */
  segment?: string;
  singleton: boolean;
  /** habilita ordenação drag-and-drop (generaliza o hardcoded type==="person"). */
  orderable: boolean;
  schema: z.ZodType<Record<string, unknown>>;
  toListItem: (data: Record<string, unknown>) => ContentListItem;
}

export type ContentRegistry = Record<string, ContentTypeDef>;

/** O bundle de registry + roteamento injetado, derivado do config no cliente. */
export interface RegistryBundle {
  registry: ContentRegistry;
  /** ordem canônica dos tipos (== enum content_type). */
  contentTypes: readonly string[];
  /** segmento plural → type (só coleções não-singleton). */
  segmentToType: Record<string, string>;
  /** chave lógica de rota → { type, slug } (singletons). */
  singletonPages: Record<string, { type: string; slug: string }>;
}

// ---------------------------------------------------------------------------
// EngineDeps — o pacote de dependências que o cliente injeta na factory.
// ---------------------------------------------------------------------------

export interface EngineDeps {
  db: EngineDb;
  schema: EngineSchema;
  audit: AuditPort;
  webhooks: WebhooksPort;
  /** Ausente => coleção sem facets. */
  facets?: FacetPort;
  /** REGISTRY + roteamento montado do config (ADR-002 §1). */
  registry: RegistryBundle;
}

/**
 * As deps que os módulos internos (`entries`/`published`) recebem: as
 * `EngineDeps` do cliente + os métodos de registry já fechados sobre
 * `deps.registry` por `createEngine`. Assim `entries.ts`/`published.ts` usam
 * `deps.validateContent`/`deps.defForType` sem import estático de `./types`.
 */
export interface EngineInternalDeps extends EngineDeps {
  validateContent: (type: string, data: unknown) => ValidationResult;
  defForType: (type: string) => ContentTypeDef;
}

// ---------------------------------------------------------------------------
// Factory (corpo preenchido em S1.3b).
// ---------------------------------------------------------------------------

// Import tardio dos módulos de implementação para evitar ciclo de tipos no
// topo do arquivo (di.ts é importado por entries.ts/published.ts).
// eslint-disable-next-line import/first
import { createEntriesApi } from "./entries.js";
// eslint-disable-next-line import/first
import { createPublishedApi } from "./published.js";
// eslint-disable-next-line import/first
import { NotFoundError } from "./errors.js";

/**
 * Recebe as deps do cliente e devolve o motor de conteúdo já ligado. Cada
 * função fecha sobre `deps` — o corpo é o de hoje, trocando `db`→deps.db,
 * `contentEntries`→deps.schema.contentEntries, etc. Zero mudança de lógica.
 *
 * O REGISTRY (ADR-002 §1): `validateContent`/`defForType`/`resolveTypeParam`
 * fecham sobre `deps.registry` (sem estado de módulo mutável) e são passados aos
 * módulos internos + expostos na API pública.
 */
export function createEngine(deps: EngineDeps) {
  const { registry, contentTypes, segmentToType, singletonPages } =
    deps.registry;

  function defForType(type: string): ContentTypeDef {
    const def = registry[type];
    if (!def) throw new NotFoundError(`unknown content type "${type}"`);
    return def;
  }

  function validateContent(type: string, data: unknown): ValidationResult {
    const parsed = defForType(type).schema.safeParse(data);
    if (parsed.success)
      return { ok: true, data: parsed.data as Record<string, unknown> };
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      errors[issue.path.join(".") || "_"] = issue.message;
    }
    return { ok: false, errors };
  }

  function resolveTypeParam(param: string): string | null {
    if (segmentToType[param]) return segmentToType[param];
    return registry[param] ? param : null;
  }

  const internalDeps: EngineInternalDeps = {
    ...deps,
    validateContent,
    defForType,
  };

  const entries = createEntriesApi(internalDeps);
  const published = createPublishedApi(internalDeps);
  return {
    // write/CRUD/publish
    listEntries: entries.listEntries,
    getEntry: entries.getEntry,
    createEntry: entries.createEntry,
    updateEntry: entries.updateEntry,
    publishEntry: entries.publishEntry,
    unpublishEntry: entries.unpublishEntry,
    deleteEntry: entries.deleteEntry,
    reorderEntries: entries.reorderEntries,
    addTranslation: entries.addTranslation,
    listTranslations: entries.listTranslations,
    listVersions: entries.listVersions,
    restoreVersion: entries.restoreVersion,
    // read API
    serializeEntry: published.serializeEntry,
    listPublished: published.listPublished,
    listPublishedCases: published.listPublishedCases,
    getPublished: published.getPublished,
    // registry + roteamento (ADR-002 §1) — antes eram módulo estático em types.ts.
    defForType,
    validateContent,
    resolveTypeParam,
    contentTypes,
    segmentToType,
    singletonPages,
  } as const;
}

export type Engine = ReturnType<typeof createEngine>;
