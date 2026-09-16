# ADR-002 — Seam do REGISTRY (config→motor) e extensão do contrato `FieldConfig`

> **Status:** ACEITA (2026-08-03)
> **Autor:** Aria (@architect)
> **Contexto:** design spike para destravar a Fase 2 (S2.1). O @dev entregou os builders (`content-builders.ts`, `named-validators.ts`) + a prova de identidade forte TEST-001 (core 82/82 verde), mas parou o wiring do motor (S2.1 T6/T7/T8, ACs 2/3/4/6) em **duas lacunas de design reais**, documentadas no Dev Agent Record de `docs/stories/2.1.builders-do-config.md`. Ambas exigem decisão de arquitetura antes do rewire.
> **Escopo:** duas decisões — (1) **seam do REGISTRY** (como o config dirige o motor sem o core importar o config); (2) **extensão mínima do `FieldConfig`** (para o `buildZodSchema` gerado ser byte-idêntico aos schemas gold-standard, sem afrouxar a validação).
> **Relacionado:** ADR-001 (injeção `db`+schema, factory `createEngine`, pacote `@cms-core/core`); `cms-factory-architecture.md` §4.1, §5 R1, §5.6, §6.1/§6.2; decisões travadas D2 (codegen build-time), Artigo IV (No Invention).

---

## Problema (fundamentado no código real)

Após a Fase 1 (S1.3b), o **motor** vive em `packages/core/src/engine/`, não mais no cliente. Dois fatos verificados no código bloqueiam o R1:

**Fato A — o REGISTRY é consumido DENTRO do core.** `engine/types.ts` declara `REGISTRY`/`validateContent`/`defForType` a partir dos **schemas Zod hand-written por tipo** (`caseSchema`, `personSchema`, …, 9 literais). E `engine/entries.ts` (linhas 14–15, 121, 134, 195, 257) e `engine/published.ts` (linha 8, 64) importam `validateContent`/`defForType` **estaticamente de `./types`**. Ou seja, a lógica de CRUD/publish do core está hoje amarrada ao REGISTRY hardcoded do Demo Corp. Além disso, ~20 páginas/rotas do cliente importam `resolveTypeParam`/`REGISTRY`/`SINGLETON_PAGES`/`SEGMENT_TO_TYPE` de `@cms-core/core/engine`. Para o REGISTRY "derivar do config", ele **não pode migrar para o cliente** (quebraria as factories do core) nem o core pode `import "…/client.config.ts"` (violaria a agnosticidade da ADR-001 e D1).

**Fato B — os schemas gold-standard codificam nuance POR CAMPO que o `FieldConfig` não expressa.** Comparando `engine/types.ts` (os 9 schemas Zod reais) com o que `content-builders.ts::buildFieldSchema` produz hoje a partir do `FieldConfig` (`kind` + `required` + `validate.pattern|custom`), há divergências sistemáticas: dois campos `kind:"text"` opcionais têm defaults **diferentes** (`region.country` → `.default("")`, `person.regionSlug` → `.optional()`); `page_book.purchaseUrl` é uma URL **requerida**; `tags` tem preprocess de trim/dedup; `elements`/`items` são **arrays de objetos com shape aninhado**. Um `buildZodSchema` genérico do contrato atual produz schemas **mais frouxos** — e o teste `content-case-validation.test.ts` (linhas 12–20) prova que `.default("")` é **observável e testado** (`r.data.quote === ""`, não `undefined`). Reproduzir isso exige estender o contrato — mas Artigo IV proíbe inventar campos de config sem rastro na §4.1.

As duas lacunas são **ortogonais**: A é sobre *onde a montagem config-driven ocorre*; B é sobre *o vocabulário do contrato*. Resolvidas juntas destravam o rewire físico do motor (S2.1 T6–T8) + o `gen-zod` (§6.2).

---

## Decisão 1 — Seam do REGISTRY: o **registry vira uma dep injetada em `createEngine`**, estendendo ADR-001

### Escolha: **opção (a)** — `createEngine({ db, schema, registry, … })`, e `validateContent`/`defForType` passam a operar sobre `deps.registry`

O REGISTRY deixa de ser um **singleton de módulo** em `engine/types.ts` e passa a ser **mais uma dependência injetada** na factory `createEngine` (ADR-001, Decisão 1) — exatamente o mesmo padrão de `db`/`schema`/`audit`/`webhooks`/`facets`. O core define o **tipo** do registry (`ContentRegistry`) e o **shape** de uma entrada (`ContentTypeDef`), mas **não** o **conteúdo** (os 9 tipos concretos). O conteúdo é montado no cliente, no `lib/core-runtime.ts`, a partir do `client.config.ts` — que é onde ADR-001 já centraliza toda a injeção.

`validateContent` e `defForType` deixam de ser funções de módulo puras e passam a ser **métodos fechados sobre `deps.registry`**, retornados por `createEngine` como o resto da API do motor. Os call-sites internos (`entries.ts`, `published.ts`) já recebem `deps` — trocam `validateContent(type, data)` → `deps.validateContent(type, data)` / `defForType(type)` → `deps.defForType(type)` (mudança mecânica, mesma que S1.3b fez para `db`→`deps.db`).

```ts
// @cms-core/core/engine — tipos do registry (o core define o SHAPE, não o conteúdo).
export interface ContentTypeDef {
  type: string;
  label: string;
  segment?: string;            // undefined p/ singletons
  singleton: boolean;
  schema: z.ZodType<Record<string, unknown>>;
  toListItem: (data: Record<string, unknown>) => ListItem;
}
export type ContentRegistry = Record<string, ContentTypeDef>;

// Roteamento também injetado (derivado do config, hoje hardcoded em types.ts).
export interface RegistryBundle {
  registry: ContentRegistry;
  contentTypes: readonly string[];            // ordem canônica (enum)
  segmentToType: Record<string, string>;
  singletonPages: Record<string, { type: string; slug: string }>;
}

// EngineDeps GANHA o registry bundle (estende ADR-001 EngineDeps).
export interface EngineDeps {
  db: EngineDb;
  schema: EngineSchema;
  audit: AuditPort;
  webhooks: WebhooksPort;
  facets?: FacetPort;
  registry: RegistryBundle;                   // ← NOVO (Decisão 1)
}

// createEngine passa a EXPOR validateContent/defForType/resolveTypeParam
// fechados sobre deps.registry — sem estado de módulo mutável.
export function createEngine(deps: EngineDeps) {
  const { registry, contentTypes, segmentToType, singletonPages } = deps.registry;

  function defForType(type: string): ContentTypeDef {
    const def = registry[type];
    if (!def) throw new NotFoundError(`unknown content type "${type}"`);
    return def;
  }
  function validateContent(type: string, data: unknown): ValidationResult {
    const parsed = defForType(type).schema.safeParse(data);
    if (parsed.success) return { ok: true, data: parsed.data };
    const errors: Record<string, string> = {};
    for (const i of parsed.error.issues) errors[i.path.join(".") || "_"] = i.message;
    return { ok: false, errors };
  }
  function resolveTypeParam(param: string): string | null {
    if (segmentToType[param]) return segmentToType[param];
    return registry[param] ? param : null;
  }

  const entries   = createEntriesApi({ ...deps, defForType, validateContent });
  const published = createPublishedApi({ ...deps, defForType });
  return {
    ...entries, ...published,
    // roteamento + validação agora saem do motor instanciado:
    defForType, validateContent, resolveTypeParam,
    contentTypes, segmentToType, singletonPages,
  } as const;
}
```

**No cliente (`lib/core-runtime.ts`) — a montagem config-driven acontece AQUI**, usando os builders que o @dev já entregou (`buildContentRegistry`, `buildSingletonPages`, `buildSegmentToType`, `buildContentTypes`, `buildZodSchemas`) + os `behaviors` (schema/toListItem):

```ts
import { demoCorpConfig } from "@/client.config";
import {
  buildContentRegistry, buildSingletonPages, buildSegmentToType,
  buildContentTypes, buildZodSchemas, registerNamedValidator,
} from "@cms-core/core/config";

// Fase 1 (hoje): behaviors = schemas gerados por buildZodSchemas + toListItem.
// Após Decisão 2 (FieldConfig estendido), buildZodSchemas produz schemas
// byte-idênticos aos gold-standard — os behaviors deixam de precisar de schema
// hand-written. toListItem continua injetado (é comportamento de derivação de
// título/summary, fora do escopo do FieldConfig).
const schemas = buildZodSchemas(demoCorpConfig);
const behaviors = Object.fromEntries(
  demoCorpConfig.collections.map((c) => [c.type, {
    schema: schemas[c.type],
    toListItem: toListItemFor(c),   // helper local; ver Decisão 2 (toListItem)
  }]),
);

const registryBundle = {
  registry:       buildContentRegistry(demoCorpConfig, behaviors),
  contentTypes:   buildContentTypes(demoCorpConfig),
  segmentToType:  buildSegmentToType(demoCorpConfig),
  singletonPages: buildSingletonPages(demoCorpConfig),
};

const engine = createEngine({ db: edb, schema: coreSchema, audit, webhooks, facets, registry: registryBundle });

// Re-exports p/ os ~20 call-sites (path idêntico; assinatura idêntica):
export const validateContent  = engine.validateContent;
export const defForType       = engine.defForType;
export const resolveTypeParam = engine.resolveTypeParam;
export const SINGLETON_PAGES  = registryBundle.singletonPages;
export const SEGMENT_TO_TYPE  = registryBundle.segmentToType;
export const CONTENT_TYPES    = registryBundle.contentTypes;
```

`engine/types.ts` perde `REGISTRY`, `validateContent`, `defForType`, `resolveTypeParam`, `SEGMENT_TO_TYPE`, `SINGLETON_PAGES` e os 9 schemas literais (migram para behaviors/config); **mantém** `CONTENT_TYPES` type helpers, `isContentType`, `ValidationResult`, `ContentTypeDef` type, `extractCaseFacets` (removido em S2.5). Os ~20 call-sites que importavam de `@cms-core/core/engine` passam a importar de `@/lib/core-runtime` — **exatamente o mesmo movimento mecânico** que S1.3b já fez para `entries`/`published` (ADR-001, "Custo").

### Alternativas consideradas

| Opção | Por que NÃO |
|-------|-------------|
| **(b) Módulo de bootstrap gerado por codegen** (`generated/registry.ts` que `core-runtime.ts` importa) | O `registry.generated.ts` é útil na Fase 2 (o `gen-zod`/`gen-content-types` já emitem os schemas/mapas) — mas ele é apenas **a origem do valor injetado**, não um mecanismo de seam distinto. Ainda precisa de um ponto onde o valor entra no core, e esse ponto é `createEngine`. Escolher (b) como *seam* confundiria "de onde vem o dado" (config à mão hoje, gerado na Fase 2 — ADR-001 §6.5) com "como o dado chega ao core" (injeção). Adotamos (a) como o **seam**; (b) é a **origem** do valor na Fase 2, ortogonal e já coberto por ADR-001. |
| **(c) `configureEngine(registry)` com estado de módulo inicializado no boot** | É o risco que o @dev sinalizou: introduz **estado de módulo mutável** + **ordenação de import** — as ~20 páginas importam `REGISTRY`/`validateContent` **estaticamente**, e em Next.js/RSC a ordem de avaliação de módulos não garante que `configureEngine()` rodou antes do primeiro import estático. Um import que resolve o REGISTRY "vazio" antes do boot é um bug silencioso e não-determinístico (pior classe de bug). Injeção via factory **elimina** a janela: não há REGISTRY até `createEngine` receber suas deps; não há caminho para observar estado meio-inicializado. Rejeitada. |

### Consequências

- **Positivas:** zero estado de módulo mutável, zero ordenação de import (o REGISTRY não existe fora de uma instância do motor); tipos fortes preservados (o core define `ContentTypeDef`/`ContentRegistry`; o cliente passa um valor que satisfaz o tipo); **consistente com ADR-001** (o registry é só mais uma dep, como `facets`); testável (um `createEngine` de teste recebe um registry fake); o gate S0.3/TEST-001 continua provando identidade porque os builders (já verdes) produzem o registry, e a Decisão 2 garante que os schemas são byte-idênticos.
- **Custo:** `entries.ts`/`published.ts` trocam import estático por método de `deps` (mecânico, ~6 call-sites internos); `engine/types.ts` enxuga; `core-runtime.ts` ganha ~15 linhas de montagem (usando builders prontos); ~20 páginas trocam o **path** do import (`@cms-core/core/engine` → `@/lib/core-runtime`) — mesma migração da ADR-001, coberta pelo CI de S1.5.
- **Risco:** o `deps.registry` mal-montado (tipo faltando) falha **cedo e local** no `defForType` (fail-fast, `NotFoundError`) ou no typecheck do cliente — não silenciosamente. Aceitável.

---

## Decisão 2 — Extensão do `FieldConfig`: **6 atributos declarativos** que cobrem 100% da nuance gold-standard, sem over-engineering

### Escolha

Estender `FieldConfig` (§4.1) com um vocabulário **mínimo e completo** — cada atributo tem rastro direto num schema gold-standard real (Artigo IV satisfeito; a auditoria completa é o Apêndice A). `buildFieldSchema` passa a mapear cada atributo para o Zod **preservando o comportamento EXATO**, de modo que `buildZodSchemas(config)` produza schemas byte-idênticos aos 9 literais de `engine/types.ts` — e o TEST-001 (`toEqual`) + os testes de validação do cliente (`content-case-validation`, `content-tags-branding`, `youtube`) continuem verdes.

```ts
export interface FieldConfig {
  name: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  help?: string;
  uploadField?: string;
  validate?: FieldValidateConfig;

  // ── NOVOS (ADR-002, Decisão 2) — nuance de validação por campo ──────────────
  /**
   * valor default quando o campo está ausente/vazio. Distingue os dois "opcionais"
   * do gold-standard: `default: ""` → `z.string().default("")` (dado volta como "");
   * ausente + optional → `.optional()` (dado volta undefined). Também `default: []`
   * p/ stringList. Só literais serializáveis (string | número | boolean | [] | {}).
   */
  default?: unknown;
  /**
   * normalização de stringList antes de validar. `trim` apara cada item; `dedup`
   * remove brancos + duplicados (Set). Espelha `tagsField` (types.ts).
   */
  trim?: boolean;
  dedup?: boolean;
  /**
   * shape de item p/ kind:"json" que é um ARRAY DE OBJETOS (elements, items).
   * Cada chave → um sub-FieldConfig-lite. buildZodSchema emite
   * `z.array(z.object(shape)).default([])`. Ausente => json genérico (array de record).
   */
  itemShape?: Record<string, ItemFieldSpec>;
}

/** Sub-spec p/ campos aninhados dentro de itemShape (json array-of-objects). */
export interface ItemFieldSpec {
  kind: "text" | "media";        // os únicos usados hoje (key/title/name/year → text; logoMediaId → media)
  required?: boolean;            // true → .min(1) (text) / presente (media); false → default("")/optional()
  default?: unknown;             // ex.: description → default("")
}
```

**Mapeamento `buildZodSchema` (atributo → Zod), preservando o comportamento EXATO:**

| Atributo do `FieldConfig` | Emissão no Zod | Gold-standard que reproduz |
|---|---|---|
| `required: true` (text/textarea/richtext) | `z.string().min(1)` | `title`, `problemStatement`, `bio`, `body` |
| `default: ""` (text/textarea/richtext, sem required) | `z.string().default("")` | `quote`, `quoter`, `introduction`, `country`, `summary`, `author`, `excerpt`, `intro` |
| ausente `default`, sem required (text) | `z.string().optional()` | `regionSlug`, `ctaLabel`, `ctaHref` |
| `kind:"url"` + `required` | `z.url()` | `purchaseUrl` |
| `kind:"url"` sem required | `z.preprocess(""→undefined, z.url().optional())` (`optionalUrl`) | `mutedVideoUrl`, `linkedin`, `instagram`, `facebook`, `x` |
| `kind:"email"` sem required | `z.preprocess(""→undefined, z.email().optional())` (`optionalEmail`) | `email` |
| `kind:"media"` sem required | `z.uuid().optional()` | `logoMediaId`, `coverMediaId`, `photoMediaId`, `bannerMediaId` |
| `kind:"date"` sem required | `z.string().optional()` | `publishedDate` |
| `kind:"stringList"` + `trim`+`dedup` | `z.preprocess(trim+Set+filter, z.array(z.string()).default([]))` (`tagsField`) | `tags` (case, insight) |
| `kind:"stringList"` + `default: []` (sem dedup) | `z.array(z.string()).default([])` | `addressLines` |
| `validate.pattern` + `default`-less (text opcional) | `z.preprocess(""→undefined, z.string().regex(re).optional())` (`brandColorField`) | `brandColor` |
| `validate.custom: "youtubeUrl"` | `youtubeField` (transform → objeto/undefined) | `youtube` |
| `kind:"json"` + `itemShape` | `z.array(z.object(shape)).default([])` | `elements`, `items` |
| `kind:"facets"` | `z.object({industry,service,region,outcome: z.array(z.string())}).partial()` | (nenhum tipo do gold usa em `data`; é UI-only hoje) |

**Ajustes de precedência em `buildFieldSchema` (correção sobre o esqueleto atual):**
1. `validate.pattern` sozinho em campo opcional deve emitir o padrão `brandColorField` (`preprocess ""→undefined` + `.optional()`), **não** `z.string().regex()` cru — o esqueleto atual (linhas 245–256 de `content-builders.ts`) já tem esse ramo para base não-string, mas para `kind:"text"` com pattern ele aplica `.regex()` sem `.optional()`. Corrigir: um `text` opcional com `pattern` = `preprocess(""→undefined, string.regex.optional())`.
2. `default` tem precedência sobre `.optional()` para os kinds string (o gold usa **um ou outro** por campo — nunca ambos).

**`toListItem` (fora do `FieldConfig`, mas parte do wiring):** o gold-standard tem 3 formas — `titleSummary` genérico (title/summary/coverMediaId/tags), `person` (name/role/photoMediaId), `region` (name/city). Isso é **derivável do config** por convenção (primeiro `text` required → título; campo `summary`/`excerpt` → summary; primeiro `media` → cover; campo `tags` → tags) **exceto** o mapeamento `person.name`/`region.city`. **Decisão:** na Fase 1, `toListItem` continua **injetado** via `behaviors` (o @dev já fez isso, e o MUST-DO do @po proíbe inventar). Um atributo opcional `titleField?`/`summaryField?` no `CollectionConfig` é registrado como **follow-up de S2.6** (branding/nav já mexe em derivação de UI por config) — **fora do escopo de S2.1/S2.2**, para não sobre-engenheirar agora.

### Alternativas consideradas

| Opção | Por que NÃO |
|-------|-------------|
| **Não estender — injetar todos os schemas via `behaviors` para sempre** (o que S2.1 fez como stopgap) | Deixa `buildZodSchemas` como esqueleto frouxo permanente e mantém 9 schemas hand-written no cliente — o `gen-zod` (§6.2) não teria o que gerar, e o R1 (externalizar os mapas) ficaria **incompleto**. O objetivo da fábrica é o config ser fonte única (D2). Rejeitada. |
| **Um `zodExpr?: string` cru por campo** (config carrega a expressão Zod como string) | Máxima expressividade, zero estrutura — reintroduz código no config, quebra a validação declarativa do `validateClientConfig` (§4.2), e é um vetor de injeção. Contra D2 e a segurança do config. Rejeitada. |
| **Atributos separados `optional?` + `default?` + `min?`/`max?` já existentes** | `min`/`max` já existem em `FieldValidateConfig` (length). Um `optional?` explícito é redundante: "sem `required` e sem `default`" já **é** opcional. Adicionar `optional?` criaria estados contraditórios (`required:true, optional:true`). Modelamos o opcional como a **ausência** de `required`/`default` — menos superfície, sem contradição. |

### Consequências

- **Positivas:** `buildZodSchemas(config)` passa a ser **byte-idêntico** aos 9 schemas gold-standard → o `gen-zod` da Fase 2 tem fonte real; o TEST-001 (`toEqual`) e os testes de validação do cliente permanecem verdes (identidade preservada); o contrato ganha **6 atributos** (`default`, `trim`, `dedup`, `itemShape` + `ItemFieldSpec.kind/required/default`) — todos com rastro gold-standard (Apêndice A), sem inventar (Artigo IV). O `validateClientConfig` (§4.2) ganha a validação estrutural desses campos no `fieldSchema` (`.strict()` já rejeita chaves extras — a extensão é aditiva e não quebra os configs existentes que não usam os novos atributos).
- **Custo:** `validate.ts::fieldSchema` ganha `default`/`trim`/`dedup`/`itemShape` (aditivo); `content-builders.ts::buildFieldSchema` ganha os ramos de mapeamento acima; o **baseline `demo-corp.config.ts`** ganha esses atributos **por campo** (ex.: `quote` → `default: ""`; `tags` → `trim: true, dedup: true`; `elements` → `itemShape: {...}`; `purchaseUrl` já tem `required: true`) — trabalho mecânico guiado pela tabela de mapeamento, provado pelo TEST-001. O exemplo `acme` (§4.3) ganha 1–2 campos ilustrando `default`/`itemShape`.
- **Reversível:** os atributos são opcionais; um config que não os usa se comporta como hoje (esqueleto). A extensão não remove nada.

---

## Ações de acompanhamento

- **@sm re-drafta / ajusta:**
  - **S2.1** — adicionar ao escopo o **seam do REGISTRY** (Decisão 1: `RegistryBundle` injetado em `createEngine`; `validateContent`/`defForType` viram métodos de `deps.registry`; `core-runtime.ts` monta o bundle via builders; ~20 call-sites trocam path) e o **baseline `demo-corp.config.ts` ganhar os atributos por campo** (Decisão 2). Destravar T6/T7/T8. Voltar a **Draft** (mudança material → @po re-valida).
  - **S2.2** — `buildZodSchema` mapeia os **novos atributos** (`default`/`trim`/`dedup`/`itemShape`) além de `pattern`/`custom`; AC1 atualizado com a tabela de mapeamento (Apêndice A). Voltar a **Draft** (AC material).
  - **S2.3** — corrigir stale paths (o motor está em `packages/core/src/engine/*`, não `lib/content/*`); registrar **materializar o workspace `cli/` (package.json) como pré-requisito** (o `cli/` ainda não existe — `pnpm -r` só vê 2 workspaces). Sinalizar ao @sm.
  - Corrigir **paths pré-Fase-1** (`lib/content/*`, `lib/media/*`) em todas as stories 2.x que ainda citam o local antigo (2.1, 2.2, 2.5, 2.6) — o motor real está em `packages/core/src/engine/*` e `packages/core/src/media/*`.
- **Atualizações do doc de arquitetura** (feitas nesta passada): §4.1 (`FieldConfig` estendido + `ItemFieldSpec`), §5.6 (seam do REGISTRY como dep injetada), §6.2 (`gen-zod` usa os novos atributos; `gen-content-types` alimenta o `RegistryBundle`), Changelog (2026-08-03).

---

## Apêndice A — Auditoria completa de validação por campo (9 tipos, 63 campos)

Fonte: `packages/core/src/engine/types.ts` (schemas Zod gold-standard) vs. `FieldConfig` atual. Coluna "Nuance" = o que o contrato atual **não** expressa (● = coberto só após Decisão 2). "Novo atributo" = o que a extensão adiciona.

### case (11 campos)
| Campo | Zod gold-standard | Nuance não-expressa | Novo atributo |
|---|---|---|---|
| `tags` | `tagsField` (preprocess trim+dedup, `.default([])`) | ● trim/dedup/default de array | `trim, dedup` |
| `title` | `z.string().min(1)` | — (required já expresso) | — |
| `quote` | `z.string().default("")` | ● default "" (não optional) | `default: ""` |
| `quoter` | `z.string().default("")` | ● default "" | `default: ""` |
| `mutedVideoUrl` | `optionalUrl` (preprocess ""→undef) | (kind:url opcional — já no esqueleto) | — |
| `introduction` | `z.string().default("")` | ● default "" | `default: ""` |
| `text` | `z.string().default("")` | ● default "" | `default: ""` |
| `brandColor` | `brandColorField` (preprocess+regex+optional) | ● pattern em opcional precisa preprocess+optional | (fix precedência pattern) |
| `logoMediaId` | `z.uuid().optional()` | (kind:media opcional — já) | — |
| `youtube` | `youtubeField` (transform→obj) | (validate.custom youtubeUrl — já) | — |
| `industryFacets` | (não está no `data` schema; UI-only) | facets kind não entra em `data` | — |

### solution (4)
| Campo | Zod gold | Nuance | Novo atributo |
|---|---|---|---|
| `title` | `string().min(1)` | — | — |
| `bannerMediaId` | `uuid().optional()` | — | — |
| `problemStatement` | `string().min(1)` | required | — |
| `body` | `string().default("")` | ● default "" | `default: ""` |

### person (10)
| Campo | Zod gold | Nuance | Novo atributo |
|---|---|---|---|
| `name`,`role` | `string().min(1)` | required | — |
| `bio` | `string().min(1)` | required | — |
| `photoMediaId` | `uuid().optional()` | — | — |
| `regionSlug` | `string().optional()` | ● opcional **sem** default (contraste com region.country) | (ausência de default) |
| `linkedin`,`instagram`,`facebook`,`x` | `optionalUrl` | (url opcional — já) | — |
| `email` | `optionalEmail` | (email opcional — já) | — |

### region (5)
| Campo | Zod gold | Nuance | Novo atributo |
|---|---|---|---|
| `name`,`city` | `string().min(1)` | required | — |
| `country` | `string().default("")` | ● default "" (contraste person.regionSlug) | `default: ""` |
| `summary` | `string().default("")` | ● default "" | `default: ""` |
| `addressLines` | `array(string()).default([])` | ● default [] (stringList sem dedup) | `default: []` |

### insight (8)
| Campo | Zod gold | Nuance | Novo atributo |
|---|---|---|---|
| `tags` | `tagsField` | ● trim/dedup/default | `trim, dedup` |
| `title` | `string().min(1)` | required | — |
| `author` | `string().default("")` | ● default "" | `default: ""` |
| `excerpt` | `string().default("")` | ● default "" | `default: ""` |
| `body` | `string().min(1)` | required | — |
| `coverMediaId` | `uuid().optional()` | — | — |
| `publishedDate` | `string().optional()` | ● date opcional sem default | (ausência de default) |
| `youtube` | `youtubeField` | (custom — já) | — |

### page_5h (6)
| Campo | Zod gold | Nuance | Novo atributo |
|---|---|---|---|
| `title` | `string().min(1)` | required | — |
| `intro` | `string().default("")` | ● default "" | `default: ""` |
| `elements` | `array(object({key:min1,title:min1,description:default("")})).default([])` | ● **json array-of-objects com shape aninhado** | `itemShape: {key,title,description}` |
| `youtube` | `youtubeField` | (custom — já) | — |
| `ctaLabel`,`ctaHref` | `string().optional()` | ● opcional sem default | (ausência de default) |

### page_book (5)
| Campo | Zod gold | Nuance | Novo atributo |
|---|---|---|---|
| `title` | `string().min(1)` | required | — |
| `description` | `string().min(1)` | required | — |
| `coverMediaId` | `uuid().optional()` | — | — |
| `purchaseUrl` | `z.url()` | ● **url REQUERIDA** (não optionalUrl) | `required: true` (já no config) |
| `youtube` | `youtubeField` | (custom — já) | — |

### page_awards (2)
| Campo | Zod gold | Nuance | Novo atributo |
|---|---|---|---|
| `title` | `string().min(1)` | required | — |
| `items` | `array(object({name:min1,year:optional,logoMediaId:uuid optional})).default([])` | ● **json array-of-objects com shape aninhado** | `itemShape: {name,year,logoMediaId}` |

### page_legal (2)
| Campo | Zod gold | Nuance | Novo atributo |
|---|---|---|---|
| `title` | `string().min(1)` | required | — |
| `body` | `string().min(1)` | required | — |

### Resumo quantitativo
- **9 tipos, 63 campos** auditados (incl. `industryFacets` UI-only).
- **Nuances não-expressas pelo `FieldConfig` atual:** **5 classes** —
  1. `default: ""` para strings opcionais (**12 campos**: quote, quoter, introduction, text, body[solution], country, summary, author, excerpt, intro; + description[5h já required]).
  2. opcional **sem** default = `.optional()` (**5 campos**: regionSlug, publishedDate, ctaLabel, ctaHref, + os já-optionais url/email/media que o esqueleto cobre).
  3. `trim`+`dedup`+`default([])` em stringList (`tagsField`) — **2 campos** (tags×2) + `default([])` puro (**1 campo**: addressLines).
  4. json **array-of-objects com shape aninhado** — **2 campos** (elements, items).
  5. `url` **requerida** e `pattern` em opcional (precedência preprocess+optional) — **2 campos** (purchaseUrl, brandColor).
- **Extensão do contrato:** **6 atributos** (`default`, `trim`, `dedup`, `itemShape` + `ItemFieldSpec.{kind,required,default}`) cobrem **100%** dos casos, sem inventar (cada um com rastro nesta tabela — Artigo IV).
- **Já cobertos pelo esqueleto atual (sem novo atributo):** required (min1), url/email/media/date opcionais, `validate.pattern` (com o fix de precedência), `validate.custom` (youtubeUrl/hexColor).
