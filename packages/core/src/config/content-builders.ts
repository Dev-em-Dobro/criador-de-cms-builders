// @cms-core/config — content builders da Fase 2 (R1). Externalizam os MAPAS do
// motor de conteúdo (REGISTRY, FIELDS, CONTENT_TYPES, SINGLETON_PAGES,
// SEGMENT_TO_TYPE, emptyData, IMAGE_POLICIES) para DERIVAREM do `ClientConfig`,
// eliminando os literais hardcoded de tipo (`"case"`, `"solution"`, …) do motor.
//
// Rastreável a §5 R1 e §6.2 do doc de arquitetura.
//
// ── Alvo real (divergência documentada dos file-paths da story) ──────────────
// A story S2.1 cita `clients/demo-corp/lib/content/{types,ui-fields}.ts`,
// mas a Fase 1 (S1.3) JÁ extraiu esse motor para `packages/core/src/engine/`. O
// cliente consome `REGISTRY`/`FIELDS`/… de `@cms-core/core/engine`. Portanto o
// alvo REAL de "derivar do config" é o motor do core — o mesmo intent dos ACs
// (mapas config-driven, zero literal hardcoded, prova de identidade), no local
// correto. O mission prompt reconhece isto explicitamente.
//
// ── Seam de schema (decisão de CORREÇÃO > completude) ────────────────────────
// Os schemas Zod por tipo do gold-standard codificam comportamento POR CAMPO que
// o contrato `FieldConfig` atual NÃO expressa (defaults por campo divergentes:
// `region.country`→"" vs `person.regionSlug`→undefined, ambos kind:text opcional;
// `page_book.purchaseUrl` url REQUERIDA; shapes json aninhados de
// `elements`/`items`; normalizer YouTube que produz objeto; normalização de
// `tags`). Reproduzi-los genericamente a partir do config exigiria estender o
// contrato (Artigo IV — No Invention: proibido inventar campos de config sem
// rastro na §4.1). Portanto `buildContentRegistry` recebe os schemas + toListItem
// por tipo INJETADOS (o motor passa os reais), enquanto a ESTRUTURA
// (ordem/label/segment/singleton) e os campos de UI derivam do config. Assim R1
// (externalização dos mapas) fica completo e a validação gold-standard fica
// byte-idêntica. `buildZodSchema`/`buildZodSchemas` existem e são testados para
// os kinds que conseguem expressar (AC1), mas a lacuna de defaults por campo é
// reportada como follow-up (extensão do contrato), não silenciada com validação
// mais frouxa.

import { z } from "zod";
import type { ZodTypeAny } from "zod";
import type {
  ClientConfig,
  CollectionConfig,
  FieldConfig,
  ItemFieldSpec,
} from "./types.js";
import { buildContentTypes, type FieldSpec } from "./builders.js";
import { resolveNamedValidator } from "./named-validators.js";

// ---------------------------------------------------------------------------
// Registry runtime (equivalente ao ContentTypeDef do motor)
// ---------------------------------------------------------------------------

/**
 * Item de listagem compacto derivado de uma entry (para listas do admin e do
 * read API). Espelho do retorno de `toListItem` do motor.
 */
export interface ListItem {
  title: string;
  summary?: string;
  coverMediaId?: string;
  tags?: string[];
}

/** Espelho do `ContentTypeDef` do motor. */
export interface ContentRegistryEntry {
  type: string;
  label: string;
  segment?: string;
  singleton: boolean;
  /**
   * habilita ordenação drag-and-drop (generaliza o hoje-hardcoded
   * `type==="person"`). Derivado de `CollectionConfig.orderable`. ADR-003 §3.10.
   */
  orderable: boolean;
  schema: z.ZodType<Record<string, unknown>>;
  toListItem: (data: Record<string, unknown>) => ListItem;
}

/**
 * Comportamento por tipo que o config NÃO expressa (schema Zod fino +
 * toListItem). O motor injeta os valores reais do gold-standard. As CHAVES
 * devem ser exatamente `config.collections[].type` — a factory valida isso.
 */
export interface ContentTypeBehavior {
  schema: z.ZodType<Record<string, unknown>>;
  toListItem: (data: Record<string, unknown>) => ListItem;
}

/**
 * REGISTRY derivado do config. A ESTRUTURA (type/label/segment/singleton, ordem
 * de inserção) vem do config; o COMPORTAMENTO (schema/toListItem) é injetado via
 * `behaviors`. Fail-fast se faltar comportamento para algum tipo.
 */
export function buildContentRegistry(
  config: ClientConfig,
  behaviors: Record<string, ContentTypeBehavior>,
): Record<string, ContentRegistryEntry> {
  const registry: Record<string, ContentRegistryEntry> = {};
  for (const col of config.collections) {
    const behavior = behaviors[col.type];
    if (!behavior) {
      throw new Error(
        `buildContentRegistry: missing behavior (schema/toListItem) for collection "${col.type}". Provide one for every collection in config.`,
      );
    }
    const singleton = col.singleton === true;
    registry[col.type] = {
      type: col.type,
      label: col.label,
      segment: singleton ? undefined : col.segment,
      singleton,
      orderable: col.orderable === true,
      schema: behavior.schema,
      toListItem: behavior.toListItem,
    };
  }
  return registry;
}

// ---------------------------------------------------------------------------
// SINGLETON_PAGES / SEGMENT_TO_TYPE (roteamento) — 100% derivados do config
// ---------------------------------------------------------------------------

export interface SingletonPage {
  type: string;
  slug: string;
}

/**
 * SINGLETON_PAGES: chave lógica de rota → { type, slug }. Deriva do
 * `singletonRoutes` de cada coleção singleton. Ex.: page_legal com
 * `{ privacy:"privacy", cookies:"cookies", terms:"terms" }` → 3 entradas.
 */
export function buildSingletonPages(
  config: ClientConfig,
): Record<string, SingletonPage> {
  const pages: Record<string, SingletonPage> = {};
  for (const col of config.collections) {
    if (col.singleton !== true) continue;
    const routes = col.singletonRoutes ?? {};
    for (const [key, slug] of Object.entries(routes)) {
      pages[key] = { type: col.type, slug };
    }
  }
  return pages;
}

/**
 * SEGMENT_TO_TYPE: segmento plural → type (só coleções não-singleton com
 * `segment`). Ex.: `{ cases:"case", solutions:"solution", … }`.
 */
export function buildSegmentToType(
  config: ClientConfig,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const col of config.collections) {
    if (col.singleton === true) continue;
    if (col.segment) map[col.segment] = col.type;
  }
  return map;
}

// ---------------------------------------------------------------------------
// emptyData — valores iniciais por kind (100% derivado do config)
// ---------------------------------------------------------------------------

/**
 * `emptyData(config, type)`: objeto inicial do formulário. Reproduz o
 * `emptyData` do motor: stringList→[], facets→{grupos}, json→[], resto→"".
 */
export function buildEmptyData(
  config: ClientConfig,
  type: string,
): Record<string, unknown> {
  const col = config.collections.find((c) => c.type === type);
  const base: Record<string, unknown> = {};
  for (const f of col?.fields ?? []) {
    // uiHidden não entra no FIELDS gold → não entra no emptyData (ADR-003 P3).
    if (f.uiHidden === true) continue;
    switch (f.kind) {
      case "stringList":
        base[f.name] = [];
        break;
      case "facets":
        base[f.name] = { industry: [], service: [], region: [], outcome: [] };
        break;
      case "json":
        base[f.name] = [];
        break;
      default:
        base[f.name] = "";
    }
  }
  return base;
}

// ---------------------------------------------------------------------------
// IMAGE_POLICIES — 100% derivado do config (UploadPolicyConfig ≡ ImagePolicy)
// ---------------------------------------------------------------------------

/** Espelho de `ImagePolicy` (media/policies.ts) — casa 1:1 com UploadPolicyConfig. */
export interface BuiltImagePolicy {
  label: string;
  formats?: string[];
  maxBytes?: number;
  maxWidth?: number;
  maxHeight?: number;
  requireAlpha?: boolean;
  aspectRatio?: { w: number; h: number; tolerance?: number };
  preserveFormat?: boolean;
}

/**
 * IMAGE_POLICIES a partir de `config.uploadPolicies`. Mapping direto — a
 * interface já casa 1:1. Só copia as chaves presentes (paridade com o literal).
 */
export function buildImagePolicies(
  config: ClientConfig,
): Record<string, BuiltImagePolicy> {
  const out: Record<string, BuiltImagePolicy> = {};
  for (const [key, p] of Object.entries(config.uploadPolicies)) {
    const policy: BuiltImagePolicy = { label: p.label };
    if (p.formats !== undefined) policy.formats = p.formats;
    if (p.maxBytes !== undefined) policy.maxBytes = p.maxBytes;
    if (p.maxWidth !== undefined) policy.maxWidth = p.maxWidth;
    if (p.maxHeight !== undefined) policy.maxHeight = p.maxHeight;
    if (p.requireAlpha !== undefined) policy.requireAlpha = p.requireAlpha;
    if (p.aspectRatio !== undefined) policy.aspectRatio = p.aspectRatio;
    if (p.preserveFormat !== undefined) policy.preserveFormat = p.preserveFormat;
    out[key] = policy;
  }
  return out;
}

// ---------------------------------------------------------------------------
// FIELDS (UI) derivados do config — uiHidden-aware (ADR-003 P3, AC15)
// ---------------------------------------------------------------------------

/**
 * `FIELDS` por tipo (equivalente ao `FIELDS` do motor). Deriva de
 * `collections[].fields`, FILTRANDO campos `uiHidden` (o `industryFacets`
 * sintético não entra no `FIELDS` gold-standard). Mapeia cada `FieldConfig` para
 * `FieldSpec` omitindo as chaves opcionais ausentes (paridade byte-a-byte com o
 * literal do modelo) e descartando os atributos de validação
 * (`validate`/`default`/`trim`/`dedup`/`itemShape`) que não existem no
 * `FieldSpec` de UI. Preserva a ordem dos campos.
 */
export function buildFields(
  config: ClientConfig,
): Record<string, FieldSpec[]> {
  const fields: Record<string, FieldSpec[]> = {};
  for (const col of config.collections) {
    fields[col.type] = col.fields
      .filter((f) => f.uiHidden !== true)
      .map((f) => {
        const spec: FieldSpec = { name: f.name, label: f.label, kind: f.kind };
        if (f.required !== undefined) spec.required = f.required;
        if (f.help !== undefined) spec.help = f.help;
        if (f.uploadField !== undefined) spec.uploadField = f.uploadField;
        return spec;
      });
  }
  return fields;
}

// ---------------------------------------------------------------------------
// buildZodSchema / buildZodSchemas (AC1) — mapeamento kind → Zod byte-idêntico
// ---------------------------------------------------------------------------
//
// ADR-002 Decisão 2 + ADR-003 §3.5: o mapeamento reproduz EXATAMENTE os 9
// schemas Zod hand-written de `engine/types.ts` a partir dos atributos por campo
// do `FieldConfig` estendido (`default`/`trim`/`dedup`/`itemShape` + `required`
// + `validate`). Campos `uiHidden` são filtrados (o `industryFacets` não entra
// no `z.object` do `case` — o `caseSchema` gold não tem essa chave).

/**
 * Mapeia UM campo do config para seu validador Zod, reproduzindo o comportamento
 * gold-standard exato (ADR-002 §2, tabela atributo→Zod). Precedência:
 *   1. `validate.custom` → validador nomeado (substitui o base) — ex.: youtubeUrl.
 *   2. base por kind + atributos (`required`/`default`/`trim`/`dedup`/`itemShape`).
 *   3. `validate.pattern` → `.regex()` (preprocess+optional se opcional).
 */
export function buildFieldSchema(field: FieldConfig): ZodTypeAny {
  // (1) custom named validator substitui o base quando presente (ex.: youtubeUrl,
  // hexColor). O base é passado; os validadores nomeados que produzem o schema
  // completo (youtubeField/brandColorField) o ignoram.
  if (field.validate?.custom) {
    const validator = resolveNamedValidator(field.validate.custom);
    return validator(baseSchemaForKind(field));
  }

  let schema = baseSchemaForKind(field);

  // (3) validate.pattern → .regex() (robustez p/ outros clientes; o baseline usa
  // `custom:"hexColor"`). Em campo string required aplica `.regex()`; em opcional
  // (base virou preprocess) reproduz o padrão `brandColorField`.
  if (field.validate?.pattern) {
    const re = new RegExp(field.validate.pattern);
    if (schema instanceof z.ZodString) {
      schema = schema.regex(re);
    } else {
      schema = z.preprocess(
        (v) => (v === "" ? undefined : v),
        z.string().regex(re).optional(),
      );
    }
  }

  return schema;
}

/** Schema base por kind + atributos por campo (ADR-002 §2 — byte-idêntico). */
function baseSchemaForKind(field: FieldConfig): ZodTypeAny {
  const required = field.required === true;
  const hasDefault = field.default !== undefined;
  switch (field.kind) {
    case "text":
    case "textarea":
    case "richtext":
      // required → min(1); default:"" → default(""); senão → optional().
      if (required) return z.string().min(1);
      if (hasDefault) return z.string().default(field.default as string);
      return z.string().optional();
    case "url":
      // url requerida → z.url(); opcional → optionalUrl (blank = não provido).
      return required
        ? z.url()
        : z.preprocess((v) => (v === "" ? undefined : v), z.url().optional());
    case "email":
      return required
        ? z.email()
        : z.preprocess((v) => (v === "" ? undefined : v), z.email().optional());
    case "media":
      // referência a media_assets (uuid). Opcional por padrão.
      return required ? z.uuid() : z.uuid().optional();
    case "date":
      // gold: publishedDate → z.string().optional() (não .datetime()).
      return required ? z.string().min(1) : z.string().optional();
    case "stringList":
      // trim+dedup → tagsField (preprocess Set+trim+filter); senão array.default([]).
      if (field.trim || field.dedup) {
        return z.preprocess(
          (v) =>
            Array.isArray(v)
              ? [...new Set(v.map((t) => String(t).trim()).filter(Boolean))]
              : v,
          z.array(z.string()).default([]),
        );
      }
      return z.array(z.string()).default([]);
    case "facets":
      // UI-only no gold (nenhum tipo valida facets em `data`). Presente p/
      // completude do builder; campos `facets` reais têm `uiHidden` e são
      // filtrados de `buildZodSchema`.
      return z
        .object({
          industry: z.array(z.string()),
          service: z.array(z.string()),
          region: z.array(z.string()),
          outcome: z.array(z.string()),
        })
        .partial();
    case "json":
      // itemShape → array de objetos com shape aninhado; senão json genérico.
      if (field.itemShape) {
        return z.array(z.object(itemShapeToZod(field.itemShape))).default([]);
      }
      return z.array(z.record(z.string(), z.unknown())).default([]);
    default: {
      const _never: never = field.kind;
      throw new Error(`buildFieldSchema: unsupported kind "${String(_never)}"`);
    }
  }
}

/** Converte um `itemShape` (ItemFieldSpec por chave) no shape Zod aninhado. */
function itemShapeToZod(
  shape: Record<string, ItemFieldSpec>,
): Record<string, ZodTypeAny> {
  const out: Record<string, ZodTypeAny> = {};
  for (const [key, spec] of Object.entries(shape)) {
    if (spec.kind === "media") {
      out[key] = z.uuid().optional();
    } else {
      // text
      if (spec.required) out[key] = z.string().min(1);
      else if (spec.default !== undefined)
        out[key] = z.string().default(spec.default as string);
      else out[key] = z.string().optional();
    }
  }
  return out;
}

/**
 * Schema de uma coleção: `z.object` com um validador por campo, FILTRANDO campos
 * `uiHidden` (ADR-003 P3 — o `industryFacets` não entra no `data` schema).
 */
export function buildZodSchema(fields: FieldConfig[]): ZodTypeAny {
  const shape: Record<string, ZodTypeAny> = {};
  for (const f of fields) {
    if (f.uiHidden === true) continue;
    shape[f.name] = buildFieldSchema(f);
  }
  return z.object(shape);
}

/** Mapa de schemas por tipo (equivalente ao conjunto de schemas do motor). */
export function buildZodSchemas(
  config: ClientConfig,
): Record<string, ZodTypeAny> {
  const out: Record<string, ZodTypeAny> = {};
  for (const col of config.collections) {
    out[col.type] = buildZodSchema(col.fields);
  }
  return out;
}

// Re-export para conveniência dos consumidores do motor.
export { buildContentTypes };
export type { FieldSpec, CollectionConfig, FieldConfig };
