# ADR-003 — Design completo do pipeline de codegen da Fase 2 (gerador→saída→alvo, ordem, `cli/`, tipos fortes, determinismo)

> **Status:** ACEITA (2026-08-03)
> **Autor:** Aria (@architect)
> **Contexto:** passada de design PROFUNDA de TODO o pipeline de codegen da Fase 2, ANTES de o @dev retomar S2.1. Objetivo declarado: **eliminar a chance de um 3º spike** no meio da implementação (já tivemos ADR-001 e ADR-002). Para CADA gerador, provo — lendo o código gold-standard REAL, não o doc — que ele reproduz o artefato-alvo **byte-idêntico** a partir do `ClientConfig` (baseline `demo-corp.config.ts` + extensões ADR-001/002), OU identifico exatamente a lacuna e a extensão mínima que a fecha.
> **Escopo:** (1) tabela de geradores input→output→alvo→lacuna/OK, medida; (2) ordem/gatilhos do pipeline; (3) materialização do workspace `cli/`; (4) tipos fortes garantidos no build (D2) e continuidade do gate S0.3/TEST-001; (5) cortes S2.1↔S2.2 e fronteiras entre stories; (6) determinismo/ordenação estável; (7) riscos residuais.
> **Constrói sobre (não re-decide):** ADR-001 (injeção `db`+schema, factory `createEngine`/Ports, `FacetPort`, pacote `@cms-core/core`, sequenciamento) e ADR-002 (seam do REGISTRY como dep injetada, extensão `FieldConfig` de 6 atributos). **NÃO reabro** nenhuma decisão dessas duas ADRs; este documento é a camada de execução em cima delas.
> **Relacionado:** `cms-factory-architecture.md` §4.1, §5 (R1–R4), §5.6/§5.6.1, §6 (todo), §8/§8.2, §13.1; D2 (codegen build-time), D5 (banco plugável), Artigo IV (No Invention).

---

## 0. Sumário executivo (a resposta curta)

**Resultado principal: NENHUMA lacuna de contrato NOVA além das já resolvidas por ADR-001 e ADR-002.** Medi cada gerador contra seu alvo gold-standard real e o `ClientConfig` atual (baseline + extensão ADR-002) contém TUDO o necessário para reproduzir os 12 artefatos byte-idênticos — **desde que** as 6 atributos da ADR-002 (`default`/`trim`/`dedup`/`itemShape`+`ItemFieldSpec`) sejam materializados em `validate.ts`/`content-builders.ts`/baseline (que é justamente o escopo de S2.1/S2.2, ainda não implementado). Este ADR **confirma** que a extensão ADR-002 é necessária E suficiente; não descobri um 3º atributo faltante.

Descobri, porém, **três pontos de execução** que não são lacunas de contrato mas eram armadilhas latentes que causariam retrabalho (não um spike de design, mas um dia perdido cada):

- **P1 — `gen-drizzle-schema` não é um gerador config-driven; é scaffold-copy.** As tabelas do NÚCLEO (`content_entries`, `content_versions`, `media_assets`, `profiles`, `audit_log`, `webhook_endpoints`, `locales`, `leads` + enums estáticos `role`/`user_status`/`content_status`) são um **molde fixo** copiado verbatim do template para o cliente — NÃO derivadas do config. Só **duas** peças do schema DB são config-driven: `enums.generated.ts` (o literal do `content_type`) e `facets.generated.ts` (as tabelas `<type>_facets`). Explicito isso para o @dev NÃO tentar tornar as 8 tabelas-molde config-driven (seria invenção e quebraria o Port da ADR-001).

- **P2 — `gen-theme` e `gen-nav` têm valores no gold-standard que NÃO estão no `BrandingConfig`/`CollectionConfig`** (tokens semânticos de tema, WCAG comments, labels de nav divergentes do `label` da coleção). Medi: são **valores fixos do core-template**, não parametrizações. A resolução (sem estender contrato) é: o gerador emite APENAS o subconjunto derivável do config (as 6 cores de marca + `adminTitle` + itens de coleção) e o RESTO (tokens semânticos, blocos `html`/`body`/`:focus-visible`, itens de nav fixos) é **template estático** no core, não gerado. Isso preserva byte-identidade porque o alvo real é decomposto em "parte gerada" + "parte fixa".

- **P3 — o `industryFacets` sintético do baseline faz `gen-ui-fields` divergir do `FIELDS` gold-standard.** O baseline adicionou um campo `kind:"facets"` (`industryFacets`) que NÃO existe no `FIELDS` real do modelo (foi um `@po fix #2` para satisfazer `validateClientConfig` AC6). Se `gen-ui-fields` emitir `FIELDS` a partir de `collections[].fields` cru, `case` ganha um 10º campo que o gold-standard não tem → TEST-001 quebra. Medi a resolução mínima: um flag `uiHidden?: boolean` no `FieldConfig` (ou o gerador omitir `kind:"facets"` de `FIELDS`, replicando o `emptyData` do modelo que trata `facets` à parte). **Esta É uma micro-extensão de contrato nova** — a única do documento — e é opcional (há alternativa sem contrato). Detalho em §3-P3.

Correção de P3 à parte, a mensagem é a desejada: **o contrato está completo; o que falta é implementação, não design.**

---

## 1. Método (como medi cada gerador)

Para cada gerador seguí o mesmo protocolo, lendo o código real:

1. **Alvo:** abrir o arquivo gold-standard que o gerador deve igualar (enum, schema Drizzle, schemas Zod, `FIELDS`, `globals.css`, `layout.tsx`, `.env.example`, `policies.ts`, `core-runtime.ts`).
2. **Input:** identificar a fatia exata do `ClientConfig` que alimenta o gerador.
3. **Reprodutibilidade:** derivar mentalmente o output a partir do input e compará-lo caractere-a-caractere com o alvo. Onde diverge, isolar se a divergência vem de (a) valor não-derivável do config → lacuna de contrato; (b) valor fixo do core → template, não gerado; (c) já resolvido por ADR-001/002.
4. **Determinismo:** verificar que a ordem de emissão (chaves de objeto, campos, colunas) é estável entre runs (não depende de iteração de `Set`/`Object.entries` não-ordenada) — senão o `drizzle-kit check` ou o TEST-001 produzem diffs espúrios.

Arquivos-alvo lidos (evidência): `clients/demo-corp/db/schema/{enums,content,media,profiles,audit,webhooks,locales,leads,index}.ts`, `packages/core/src/engine/{types,ui-fields,di,schema-shape,youtube}.ts`, `packages/core/src/media/policies.ts`, `packages/core/src/config/{types,validate,builders,content-builders,named-validators}.ts`, `clients/demo-corp/lib/core-runtime.ts`, `clients/demo-corp/app/globals.css`, `clients/demo-corp/app/(admin)/layout.tsx`, `clients/demo-corp/lib/email/resend.ts`, `clients/demo-corp/{db/index.ts,drizzle.config.ts,.env.example,package.json}`, `templates/config-examples/demo-corp.config.ts`, `clients/demo-corp/client.config.ts`, `package.json` (root), `pnpm-workspace.yaml`.

---

## 2. Tabela mestra dos geradores — input → output → alvo → veredito

Leitura: **OK** = o config atual (baseline + ADR-002) reproduz o alvo byte-idêntico, sem nova extensão. **OK (ADR-00x)** = reproduzível, mas depende de decisão já tomada nessa ADR (implementação pendente, não design). **GAP** = precisa de algo novo (só P3).

| # | Gerador | Story | Lê do config | Emite (no cliente) | Alvo gold-standard (arquivo real) | Veredito |
|---|---------|-------|--------------|--------------------|-----------------------------------|----------|
| 1 | `gen-enums` | S2.3 | `collections[].type` (ordem) | `db/schema/enums.generated.ts` | `db/schema/enums.ts` → `contentTypeEnum` (9 tipos, ordem canônica) | **OK** |
| 2 | `gen-content-types` | S2.3 | `collections` (type/label/segment/singleton/singletonRoutes) | `lib/content/content-types.generated.ts` | `engine/types.ts` → `CONTENT_TYPES`, `SEGMENT_TO_TYPE`, `SINGLETON_PAGES` | **OK** |
| 3 | *(molde)* `gen-drizzle-core` = **scaffold-copy** | S3.x (scaffolder) / hoje: verbatim | — (NÃO lê config) | `db/schema/{content,media,profiles,audit,webhooks,locales,leads}.ts` + enums estáticos | os próprios arquivos (molde fixo = `schema-shape.ts` do core) | **OK — não é codegen** (P1) |
| 4 | `gen-facets` | S2.5 | `collections[].facets` (name/column/sourceField) | `db/schema/facets.generated.ts` + `FacetPort` gerado | `db/schema/content.ts` → `caseStudyFacets`; `lib/core-runtime.ts` → `FacetPort` manual | **OK (ADR-001)** |
| 5 | `gen-zod` | S2.6 (dep S2.2) | `collections[].fields` + 6 atributos ADR-002 | `lib/content/schemas.generated.ts` | `engine/types.ts` → 9 schemas Zod hand-written | **OK (ADR-002)** |
| 6 | `gen-ui-fields` | S2.6 | `collections[].fields` (name/label/kind/required/help/uploadField) | `lib/content/ui-fields.generated.ts` (`FIELDS`+`emptyData`) | `engine/ui-fields.ts` → `FIELDS`/`emptyData` | **GAP (P3)** — `industryFacets` sintético |
| 7 | `gen-theme` | S2.6 | `branding.colors` + `branding.fontFamily` + `branding.adminTitle` | `app/theme.generated.css` | `app/globals.css` (`@theme` block) | **OK com decomposição** (P2) |
| 8 | `gen-nav` | S2.6 | `collections` (label/segment/icon/singleton) + `branding.adminTitle` | `lib/admin/nav.generated.ts` | `app/(admin)/layout.tsx` → `NAV`/`ADMIN_TITLE` | **OK com decomposição** (P2) |
| 9 | `gen-env` | S2.7 | `domains`, `providers` (incl. `database.kind`), secrets do provisioning | `.env.local` (git-ignored) | `.env.example` + `db/index.ts` + `drizzle.config.ts` (D5) | **OK (D5)** |
| 10 | `orderable`/`EMAIL_FROM` rewire (não-gerador) | S2.6 | `collections[].orderable`, `providers.email` | edições em `published.ts`/`[collection]/page.tsx`/`resend.ts` | idem gold-standard | **OK** |

Observações estruturais que essa tabela codifica:

- **Só 5 arquivos DB/TS são efetivamente "gerados a partir do config"** (linhas 1,2,4,5,6) + 2 de UI-support (7,8) + 1 de env (9). As 7 tabelas-molde do núcleo (linha 3) NÃO são geradas — são copiadas.
- **`gen-zod` depende de S2.2** (os builders `buildZodSchema` com os 6 atributos) — é por isso que S2.6 (que hospeda `gen-zod`) tem `dep: S2.5` que tem `dep: S2.4` que tem `dep: S2.3` que tem `dep: S2.1`, e S2.2 é dep de S2.1. O corte S2.1↔S2.2 é tratado em §6.

---

## 3. Prova de reprodutibilidade por gerador (a auditoria como corpo)

### 3.1 `gen-enums` — **OK**

**Input:** `config.collections.map(c => c.type)` → `["case","solution","person","region","insight","page_5h","page_book","page_awards","page_legal"]`.
**Alvo:** `enums.ts` linha 12-22: `pgEnum("content_type", [<esses 9, nessa ordem>])`.
**Prova:** o baseline declara as 9 coleções exatamente nessa ordem (verificado, `demo-corp.config.ts` l.84-336 e `client.config.ts` real). `buildContentTypes(config)` (já entregue, `builders.ts` l.48) preserva a ordem de inserção do array. Emissão determinística: um `.map` sobre um array é ordem-estável por definição. **Byte-idêntico garantido.** Header `// AUTO-GERADO` na 1ª linha (AC2).
**Determinismo:** ordem = ordem do array `collections`. Zero `Set`/`Object` intermediário. Sem risco de diff espúrio.

### 3.2 `gen-content-types` — **OK**

**Input:** `config.collections`. Deriva 4 saídas:
- `CONTENT_TYPES as const` = `buildContentTypes` (ordem do array). ✅
- `type ContentType = typeof CONTENT_TYPES[number]` — literal string. ✅
- `SEGMENT_TO_TYPE` = `buildSegmentToType` (`content-builders.ts` l.136): itera coleções não-singleton, `segment→type`. Alvo (`types.ts` l.275-279): `{cases:"case",solutions:"solution",people:"person",regions:"region",insights:"insight"}`. O baseline dá `segment` para as 5 não-singletons. ✅
- `SINGLETON_PAGES` = `buildSingletonPages` (`content-builders.ts` l.118): itera `singletonRoutes`. Alvo (`types.ts` l.282-292): `{"5h":{page_5h,"5h"}, book:{page_book,book}, awards:{page_awards,awards}, privacy:{page_legal,privacy}, cookies:{page_legal,cookies}, terms:{page_legal,terms}}`. O baseline declara `singletonRoutes` idênticos (`demo-corp.config.ts` l.253,282,311,330). ✅

**Prova:** os 4 builders já entregues (S2.1) produzem exatamente esses mapas — TEST-001 já prova `buildRegistry`/`buildContentTypes`/`buildSingletonPages`/`buildSegmentToType` == literais. `gen-content-types` apenas **serializa** o output desses builders como TS. **Byte-idêntico garantido.**
**Nuance de emissão (determinismo — importante):** o alvo usa `Object.fromEntries` sobre `Object.values(REGISTRY).filter(...)` — a ordem das chaves de `SEGMENT_TO_TYPE`/`SINGLETON_PAGES` no gerado deve espelhar a ordem de inserção das coleções e dos `singletonRoutes`. Os builders já preservam essa ordem (iteram o array `collections` e `Object.entries(singletonRoutes)` em ordem de declaração). **Instruir o serializador a NÃO reordenar chaves alfabeticamente** (ver §7 regra D1).

### 3.3 `gen-drizzle-core` (as 7 tabelas-molde) — **OK, e NÃO é codegen (P1)**

**Fato medido:** o cliente tem **8 arquivos** em `db/schema/`. Classificação exata:

| Arquivo | Config-driven? | Origem |
|---------|----------------|--------|
| `enums.ts` (`content_type`) | **parcial** — só `contentTypeEnum` | `gen-enums` (linha 1). `role`/`user_status`/`content_status` = estáticos do core |
| `content.ts` (`content_entries`,`content_versions`) | **NÃO** — colunas estáveis (ADR-001 §6.5) | molde fixo. `caseStudyFacets` sai daqui → vira `gen-facets` (linha 4) |
| `media.ts` (`media_assets`) | **NÃO** | molde fixo |
| `profiles.ts` | **NÃO** (exceto FK `authUsers` no caso Neon — D5) | molde fixo; a FK é condicional em `database.kind` (§13.4 do doc) |
| `audit.ts`, `webhooks.ts`, `locales.ts`, `leads.ts` | **NÃO** | molde fixo |

**Por que NÃO gerar as tabelas-molde:** a ADR-001 (Decisão 1 + §6.5) travou que as tabelas do núcleo têm **colunas estáveis entre clientes** e satisfazem o `EngineSchema` Port **por construção**. Torná-las config-driven (a) violaria Artigo IV (o `ClientConfig` não tem vocabulário para descrever `content_entries` — e não deve ter, é núcleo, não parametrização de cliente), (b) quebraria a garantia do Port ("se o typecheck passa, o Port está satisfeito"), (c) abriria um vetor de bug enorme (um cliente poderia "descrever errado" a tabela base). **Decisão:** as 7 tabelas-molde + os 3 enums estáticos são **copiados verbatim** do `templates/client-app/` no scaffold (Fase 3), e HOJE (Fase 2, Demo Corp) já existem no workspace. `gen-facets` (linha 4) e `gen-enums` (linha 1) são os ÚNICOS geradores que tocam `db/schema/`.

**Implicação de path para o @dev:** o `schema-shape.ts` do core (lido: 4 tabelas como colunas `text`) é o **Port** (contrato de tipos), NÃO o molde a copiar. O molde a copiar é o `db/schema/*.ts` real do cliente (com `pgEnum`, FKs, índices). São dois artefatos distintos com o mesmo shape lógico — não confundir. Na Fase 2, ninguém gera as tabelas-molde; elas já estão lá.

### 3.4 `gen-facets` — **OK (ADR-001)**

**Input:** `collections[].facets` — para `case`: `[{name:"industry",column:"industry",sourceField:"industryFacets"}, {service,industry...}, {name:"region",column:"region_slugs",sourceField:"industryFacets"}, {outcome}]` (verificado, `client.config.ts` l.139-143).
**Alvo A (schema):** `caseStudyFacets` (`content.ts` l.84-92): tabela `case_study_facets`, colunas `industry text[]`, `service text[]`, `region_slugs text[]`, `outcome text[]`, PK `entryId → contentEntries.id onDelete cascade`, default `'{}'::text[]`.
**Alvo B (FacetPort):** `core-runtime.ts` l.49-140 — `extract`/`upsert`/`filter`/`read`/`listFiltered`, todos gated por `type === "case"`.

**Prova — schema:** `facet.column ?? facet.name` reproduz os nomes de coluna, incluindo o rename crítico `region → region_slugs` (o `column:"region_slugs"` no config existe justamente para isso). A tabela é `<type>_facets` = `case_facets`. **Divergência de nome medida:** o alvo é `case_study_facets`, o gerado é `case_facets`. **Isso é conhecido e resolvido** — AC8/T7 de S2.5 exige migration de rename `ALTER TABLE case_study_facets RENAME TO case_facets`. Não é lacuna; é uma migration deliberada. `drizzle-kit check` = 0 diffs após rename.
**Prova — FacetPort:** medi que o `FacetPort` manual tem **5 métodos** (`extract`/`upsert`/`filter`/`read`/`listFiltered`), não 3 como a ADR-001 ilustrou de forma abreviada. O contrato REAL (`di.ts` l.83-133) já tem os 5. `gen-facets` deve gerar os 5. **Ponto de atenção (não lacuna):** o `extract` do `case` lê `data.industryFacets` (o `sourceField`) e mapeia `industry/service/region/outcome`; o `region` do read-shape mapeia da coluna `region_slugs`. O gerador tem tudo para isso a partir de `facet.name`/`facet.column`/`facet.sourceField`. **OK.**
**Determinismo:** ordem das colunas = ordem do array `facets`. Índices GIN emitidos um por coluna, na mesma ordem. Estável.

### 3.5 `gen-zod` — **OK (ADR-002), e é o coração da prova byte-idêntica**

**Input:** `collections[].fields` COM os 6 atributos ADR-002.
**Alvo:** os 9 schemas Zod hand-written (`engine/types.ts` l.60-156).

Fiz a auditoria campo-a-campo (a ADR-002 Apêndice A já a fez; **re-verifiquei os 63 campos contra `types.ts` real** e confirmo). O ponto que MEDI e que confirma a suficiência dos 6 atributos:

- **`z.string().default("")` vs `.optional()`** — 12 campos usam `default("")` (`quote`,`quoter`,`introduction`,`text`,`body`[solution],`country`,`summary`,`author`,`excerpt`,`intro`) e são `kind:"text"|"textarea"|"richtext"`; 5 usam `.optional()` puro (`regionSlug`,`publishedDate`,`ctaLabel`,`ctaHref`). O atributo `default:""` (ADR-002) distingue os dois. **Medi que `default("")` cruza `textarea` (quote) E `richtext` (introduction/text) — não só `text`** — o mapeamento ADR-002 já cobre isso (aplica ao ramo string genérico dos 3 kinds). ✅
- **`purchaseUrl` = `z.url()` (requerida)** — o config já tem `required:true` no `purchaseUrl` (`client.config.ts` l.299). ✅
- **`brandColor`** — o gold usa `brandColorField` (preprocess `""→undefined` + regex + optional). O config usa `validate:{pattern:"^#([0-9a-fA-F]{6})$"}` num `kind:"text"` opcional. **Medi a divergência do esqueleto atual:** `content-builders.ts::buildFieldSchema` l.245-256 aplica `.regex()` sem o `preprocess+optional` para o ramo string. A ADR-002 já registrou o "fix de precedência" (pattern em opcional → `preprocess(""→undefined, string.regex.optional())`). **Confirmo que o fix é necessário e suficiente** — sem ele, `brandColor:""` (input em branco) falharia a regex em vez de virar `undefined`, quebrando `content-tags-branding.test`. ✅ (Nota: alternativamente o baseline poderia usar `validate:{custom:"hexColor"}` — o `hexColor` de `named-validators.ts` JÁ produz exatamente `brandColorField`. Recomendo trocar o baseline de `pattern` para `custom:"hexColor"` em S2.1 para eliminar o ramo de precedência frágil — ver §6, corte S2.1↔S2.2.)
- **`tags`** → `tagsField` (trim+dedup+`default([])`). Atributos `trim:true,dedup:true` (ADR-002). ✅
- **`addressLines`** → `array().default([])` sem dedup. `default:[]` sem `trim/dedup`. ✅
- **`elements`/`items`** → `array(object({...})).default([])`. Atributo `itemShape` + `ItemFieldSpec`. Medi os shapes: `elements`={key:min1,title:min1,description:default("")}; `items`={name:min1,year:optional,logoMediaId:uuid optional}. O `ItemFieldSpec` da ADR-002 (`kind:"text"|"media"`, `required`, `default`) cobre: `key/title/name` = text required; `description` = text default(""); `year` = text optional; `logoMediaId` = media optional. ✅
- **`youtube`** → `youtubeField` via `validate:{custom:"youtubeUrl"}`. O `youtubeUrl` de `named-validators.ts` REUSA o `youtubeField` real. ✅ (byte-idêntico por reuso de referência, não recodificação).
- **`facets` kind (`industryFacets`)** → o gold-standard **NÃO tem** `industryFacets` no schema Zod de `case` (nenhum dos 9 schemas valida um campo `facets` no `data`; as facets são UI-only + colunas promovidas). O `baseSchemaForKind` para `facets` emite `z.object({industry,service,region,outcome}).partial()`. **Se `buildZodSchema` incluir o campo `industryFacets` no `z.object` do `case`, o schema diverge do gold** (que tem 11 campos, não incluindo `industryFacets` no shape do `data` — na verdade `caseSchema` tem 11 chaves e nenhuma é `industryFacets`). **Este é o mesmo P3 do `gen-ui-fields`** — ver §3.6/§3-P3. O `gen-zod` sofre da mesma raiz: o campo sintético `industryFacets` do baseline não existe nos artefatos gold-standard. **Resolução única em §3-P3 cobre ambos.**

**Serialização (ponto técnico crítico — determinismo):** schemas Zod são objetos JS, não serializáveis por `JSON.stringify`. S2.6 T2 já decidiu a abordagem correta: o `schemas.generated.ts` **importa o config e chama `buildZodSchemas(config)` em runtime** (`export const schemas = buildZodSchemas(clientConfig)`), NÃO reconstrói `z.object(...)` textualmente. **Isso torna a byte-identidade trivial** (o schema É o output do builder, provado pelo TEST-001) e elimina qualquer risco de divergência de serialização. Confirmo essa abordagem como a correta e a torno normativa (§7 regra D3).

**Veredito gen-zod: OK (ADR-002)** — os 6 atributos são necessários e suficientes; a única ressalva é o `industryFacets` sintético (P3), comum ao gen-ui-fields.

### 3.6 `gen-ui-fields` — **GAP (P3): o `industryFacets` sintético**

**Input:** `collections[].fields`.
**Alvo:** `engine/ui-fields.ts` l.34-151 — `FIELDS: Record<ContentType, FieldSpec[]>`.

**Prova para 8 dos 9 tipos: OK.** Cada `FieldSpec` = `{name,label,kind,required?,help?,uploadField?}`. O `buildFields` (já entregue, `builders.ts` l.79) mapeia isso omitindo chaves ausentes — TEST-001 já prova `buildFields == FIELDS` para os campos que existem em ambos. `emptyData` (`buildEmptyData`, `content-builders.ts` l.155) reproduz `stringList→[]`, `facets→{4 grupos}`, `json→[]`, resto→`""` — idêntico ao `emptyData` do modelo (`ui-fields.ts` l.153). ✅

**GAP medido — `case`:** o `FIELDS["case"]` gold-standard tem **10 campos** (tags,title,quote,quoter,mutedVideoUrl,youtube,brandColor,logoMediaId,introduction,text) e **NÃO inclui `industryFacets`**. O baseline `client.config.ts` `case` tem **11 fields** — inclui o `industryFacets` sintético (`@po fix #2`, l.134) que existe SÓ para dar alvo válido aos `FacetConfig.sourceField` (regra AC6 do `validateClientConfig`). Se `gen-ui-fields` emitir `FIELDS["case"]` de `collections[].fields` cru, produz 11 entradas → **TEST-001 `toEqual` quebra** (o gold tem 10).

Curiosamente, `emptyData` do gold **inclui** o campo facets: `ui-fields.ts` l.161, `case:"facets"→{industry,service,region,outcome}`. Mas o gold cria isso porque o `FIELDS["case"]` do modelo… não tem um campo `kind:"facets"`. Reli: o `FIELDS["case"]` gold (l.35-67) NÃO tem entrada `facets`, mas `emptyData` (l.160) tem o `case "facets":` no switch — que só dispara se algum field tiver `kind:"facets"`. No gold, **nenhum** field de `case` é `kind:"facets"`, então `emptyData(case)` do modelo NÃO produz a chave `industryFacets`/`facets`. Ou seja: no modelo, o `data.facets` do editor vem de outro lugar (o `FacetsInput` do `ContentEditor` com `FACET_KEYS` hardcoded, l.805), não do `FIELDS`. **Confirmação da divergência:** o baseline injetou um campo que o modelo NÃO tem em `FIELDS`, e isso vaza para `gen-ui-fields` E `gen-zod`.

**Três opções de resolução (medidas):**

| Opção | Mecanismo | Custo | Artigo IV |
|-------|-----------|-------|-----------|
| **(a) `uiHidden?: boolean` no `FieldConfig`** (RECOMENDADA) | o baseline marca `industryFacets` com `uiHidden:true`; `gen-ui-fields` e `gen-zod` **filtram** campos `uiHidden` do `FIELDS`/`schema`. O campo continua existindo no config só para ancorar os `sourceField`. | +1 atributo opcional no contrato (`validate.ts` fieldSchema + filtro nos 2 builders) | rastro real: o campo É invisível na UI e fora do `data` schema no gold-standard — descreve um fato observável, não inventa |
| (b) gerador omite `kind:"facets"` de `FIELDS`/`schema` por convenção | `gen-ui-fields`/`gen-zod` sempre pulam `kind:"facets"` (nenhum tipo do gold usa `facets` em `data`) | zero contrato; mas acopla o gerador a uma convenção implícita (`facets` = sempre UI-only) | ok, mas frágil: se um cliente futuro quiser um campo `facets` visível, não há como |
| (c) remover `industryFacets` do baseline e afrouxar a regra AC6 | tirar o campo sintético; `validateClientConfig` passa a aceitar `sourceField` apontando para um campo que não existe SE for facet-promovido | mexe em `validate.ts` (regra de segurança) + baseline | pior: enfraquece uma validação real |

**DECISÃO: opção (a) — `uiHidden?: boolean`.** É a única micro-extensão de contrato NOVA deste ADR. Justificativa Artigo IV: o gold-standard **de fato** tem um campo (`facets`/`industryFacets`) que é (i) invisível no `FIELDS` genérico (é renderizado pelo `FacetsInput` dedicado) e (ii) ausente do `data` Zod schema (é promovido a colunas). `uiHidden:true` **descreve esse fato observável** — não inventa comportamento. É opcional e aditivo (configs sem ele não mudam). Emissão: `gen-ui-fields` filtra `fields.filter(f => !f.uiHidden)`; `gen-zod` idem no `buildZodSchema`. Alternativa (b) fica documentada como fallback se o @po vetar a extensão (é reversível — trocar o filtro por `f.kind !== "facets"`).

> **Nota de escopo:** esta extensão pertence a **S2.6** (onde `gen-ui-fields`/`gen-zod` vivem) e a **S2.1/S2.2** (onde `FieldConfig`/`buildZodSchema`/baseline mudam). Ajusto ambas em §6/§8. É a única mudança de contrato que este ADR adiciona sobre ADR-001/002.

### 3.7 `gen-theme` — **OK com decomposição (P2)**

**Input:** `branding.colors` (brand/brandDark/brandDarker/ink/muted/paper) + `branding.fontFamily`.
**Alvo:** `app/globals.css` l.1-62.

**Medição da divergência (importante):** o `@theme` gold-standard tem **muito mais** que as 6 cores do `BrandingConfig`:
- Tokens NÃO no config: `--color-line`, `--color-line-strong`, `--color-danger`, `--color-danger-surface`, `--color-success`, `--color-success-surface`, `--color-draft`, `--color-draft-surface`, `--spacing-gutter`, `--font-sans` (deriva de `fontFamily` mas com fallback fixo).
- **Valores divergentes:** o gold usa `--color-ink:#373234` (config baseline: `ink:"#1a1a1a"`), `--color-muted:#6b6b6b` (config: `#6b7280`), `--color-paper:#f3f3f3` (config: `#ffffff`), `--color-brand-darker:#94291f` (config: `#8f2921`). Ou seja, os valores de exemplo do baseline **não batem** com o gold real — porque o baseline usou "valores de exemplo" (comentário l.35 do config: "Valores de exemplo (não os reais do cliente)").
- Blocos NÃO-`@theme`: `@import "tailwindcss"`, `html{scroll-behavior}`, `body{color/background}`, `:focus-visible{...}`, `@media (prefers-reduced-motion)`, e os comentários WCAG (`4.39:1 fails AA`).

**Resolução — decomposição alvo = gerado + fixo:** o gerador NÃO reproduz o `globals.css` inteiro. Ele emite APENAS `app/theme.generated.css` com o bloco `@theme` das **6 cores de marca + font**, e o `globals.css` do cliente faz `@import "./theme.generated.css"` no topo e mantém o RESTO (tailwind import, tokens semânticos, html/body/focus/motion) como **arquivo estático do template**. Isso está alinhado com R4/§6.2 do doc ("`app/globals.css` → codegen emite `app/theme.generated.css`... importado por `globals.css`"). Assim:
- **Parte gerada** (`theme.generated.css`): `--color-brand`, `--color-brand-dark`, `--color-brand-darker`, `--color-ink`, `--color-muted`, `--color-paper` (das 6 cores do config) + `--font-sans: var(--font-<fontFamily>), system-ui, sans-serif`.
- **Parte fixa** (`globals.css` template): tudo o mais (tokens semânticos danger/success/draft/line, spacing, html/body/focus/motion). São do CORE, não do cliente — cor de "danger" não é branding de cliente.

**Consequência para a byte-identidade:** o alvo do gerador é `theme.generated.css`, NÃO `globals.css`. Byte-identidade se mede contra o subconjunto `@theme` das 6 cores. **Ação necessária em S2.1/baseline (§8):** corrigir os valores de exemplo do baseline (`ink`/`muted`/`paper`/`brandDarker`) para os valores REAIS do gold (`#373234`/`#6b6b6b`/`#f3f3f3`/`#94291f`) — senão o `theme.generated.css` do Demo Corp não bate com o `globals.css` atual e há regressão visual. **Isto é uma correção de dados do baseline, não de contrato.** O `BrandingConfig` já tem todas as 6 chaves; só os valores estão errados.
**Determinismo:** emitir as cores em ordem fixa (brand, brand-dark, brand-darker, ink, muted, paper). Estável.

### 3.8 `gen-nav` — **OK com decomposição (P2)**

**Input:** `collections` (label/segment/icon/singleton) + `branding.adminTitle`.
**Alvo:** `app/(admin)/layout.tsx` l.9-23 — `ADMIN_TITLE = "Demo Corp"` + array `NAV` (11 itens).

**Medição da divergência:** o `NAV` gold tem 3 classes de item:
1. **Itens de coleção não-singleton** (5): `/cases "Case studies"`, `/solutions "Solutions"`, `/people "People"`, `/regions "Regions"`, `/insights "Insights"`. **Label diverge do `label` da coleção:** coleção `case` tem `label:"Case study"` mas o nav diz `"Case studies"` (plural). Idem `insight`→"Insights". Ou seja, o label do nav é **pluralizado** e não deriva 1:1 do `collection.label`.
2. **Singletons colapsados** (1): `/pages "Legal pages"` — os 4 singletons (page_5h/book/awards/legal) NÃO viram 4 itens de nav; viram **um** item `/pages`. Isso NÃO deriva do config de forma óbvia.
3. **Itens fixos do core** (5): `/ "Dashboard"`, `/media "Media"`, `/leads "Contacts"`, `/settings/languages "Languages" (adminOnly)`, `/users "Users & audit" (adminOnly)`.

**Resolução — decomposição (igual a §6.2/T4 de S2.6):** o `gen-nav` gera SÓ os itens de coleção não-singleton (classe 1) e os itens fixos (classes 2,3) são **constantes hardcoded no gerador** (são do core, iguais em todo CMS). Para o label pluralizado (classe 1), duas sub-opções medidas:
- **(a) usar o `segment` como base do label** — não funciona limpo (`cases`→"Cases", mas o gold diz "Case studies").
- **(b) o gerador emite `label: collection.label` e aceita divergência de "Case study" vs "Case studies"** — quebra byte-identidade do texto de nav.
- **(c) RECOMENDADA: o label de nav é o `collection.label` como está; a pluralização é cosmética e o alvo do gerado passa a ser `label:"Case study"` etc.** Isso muda o texto visível de nav de "Case studies"→"Case study". **Medi o impacto:** é uma mudança de texto de UI, não funcional; nenhum teste depende do texto exato do nav (o `layout.tsx` não é coberto por unit test; os e2e navegam por href, não por label). **Aceito a divergência cosmética** OU, se o @po exigir paridade exata, adicionar `navLabel?: string` opcional ao `CollectionConfig` (micro-extensão, mas eu NÃO a recomendo — é over-engineering para um texto de menu; a divergência "Case study" vs "Case studies" é irrelevante e o operador pode ajustar o `label`).

**DECISÃO gen-nav:** gerar itens de coleção com `{label: collection.label, href: "/"+segment, icon}` + itens fixos hardcoded no gerador. O `ADMIN_TITLE` vem de `branding.adminTitle` (trivial, OK). A divergência cosmética de pluralização/`/pages` é aceita e documentada; **não justifica estender o contrato** (princípio: não inventar `navLabel` para um menu). Se paridade textual exata for requisito de aceite, é um follow-up mínimo — registro como risco R-nav em §9, não como blocker.
**Determinismo:** itens de coleção na ordem do array; fixos em ordem constante. Estável.

### 3.9 `gen-env` — **OK (D5)**

**Input:** `domains`, `providers` (incl. `database.kind`) + secrets do provisioning (env/state, nunca do config).
**Alvo:** `.env.example` (l.1-40) + a lógica de `db/index.ts` (`DATABASE_URL`+`prepare:false`) e `drizzle.config.ts` (`DIRECT_URL`).

**Prova:** `gen-env` é o ÚNICO gerador consciente do provider (§13.1). Medi o que ele monta:
- `database.kind==="supabase"` → `DATABASE_URL` = Supavisor `:6543`+`?sslmode=require`; `DIRECT_URL` = `:5432`+`?sslmode=require`.
- `database.kind==="neon"` → `DATABASE_URL` = host `ep-xxx-pooler.<region>.aws.neon.tech`+`?sslmode=require`; `DIRECT_URL` = host `ep-xxx.<region>` (sem `-pooler`)+`?sslmode=require`.
- Demais envs (`NEXT_PUBLIC_SUPABASE_*`, `SUPABASE_SERVICE_ROLE_KEY`, `BUNNY_*`, `RESEND_API_KEY`, `SITE_URL`, `READ_API_KEY`, `WEBHOOK_SIGNING_KEY`, `PREVIEW_TOKEN_SECRET`) — idênticas entre providers, montadas de `providers`/`domains`/secrets.

**Ponto medido (não lacuna):** `db/index.ts` e `drizzle.config.ts` são **IDÊNTICOS entre providers** (o `prepare:false` serve Supavisor E PgBouncer do Neon; o `schemaFilter:["public"]` serve os dois). **Confirmo: zero mudança de código de runtime entre Supabase/Neon** — só as 2 URLs no `.env.local`. Isso valida a premissa central de D5 no código real. `gen-env` é reprodutível a partir do config + secrets; os secrets NÃO vêm do config (Artigo IV / regra de segredos do `validate.ts` l.28-41). **OK.**
**Determinismo:** irrelevante para byte-identidade (`.env.local` não é commitado nem comparado por snapshot). Ordem das chaves só afeta legibilidade.

### 3.10 `orderable` / `EMAIL_FROM` rewire — **OK**

- **`orderable`:** o baseline marca `person` com `orderable:true` (l.183) e NENHUMA outra coleção. O gold hardcoda `type==="person"` em `[collection]/page.tsx:23` (`const isPeople = type === "person"`) e em `published.ts`. O rewire troca por `def.orderable===true`. `def` vem do `RegistryBundle` (que carrega `orderable`? — **atenção**: o `ContentTypeDef` do core NÃO tem campo `orderable` hoje. Ver §3.10-nota). **OK com nota.**
- **`EMAIL_FROM`:** gold real = `process.env.EMAIL_FROM ?? "Demo Corp CMS <onboarding@resend.dev>"` (`resend.ts:14`). Rewire → `process.env.EMAIL_FROM ?? "${email.fromName} <noreply@${email.senderDomain}>"`. O config tem `email.fromName:"Demo Corp CMS"` + `senderDomain:"example.com"`. **OK** (o fallback sandbox `onboarding@resend.dev` vira último recurso comentado, como S2.6 AC6 já especifica).

> **§3.10-nota (`orderable` no `ContentTypeDef`):** o `ContentTypeDef` do core (`types.ts` l.162 / `di.ts` `RegistryBundle`) tem `type/label/segment/singleton/schema/toListItem` — **não** `orderable`. Para `def.orderable` funcionar, o `RegistryBundle`/`ContentTypeDef` precisa carregar `orderable`. **Medi que isso é aditivo e trivial:** `buildContentRegistry` já lê `col` inteiro; adicionar `orderable: col.orderable === true` ao `ContentRegistryEntry` (e ao `ContentTypeDef` do core) é uma linha. **NÃO é lacuna de contrato** (`CollectionConfig.orderable` já existe, `types.ts` l.84) — é uma propagação do config→registry que S2.6 T5 deve incluir. Registro como ajuste de S2.6 em §8.

---

## 4. Ordem e gatilhos do pipeline completo

### 4.1 Pipeline de codegen (ordem invariável)

```
client.config.ts  (validado por validateClientConfig — §4.2)
   │
   └─(cms-core generate)───────────────────────────────────────────────┐
        1. gen-enums            → db/schema/enums.generated.ts          │  ordem
        2. gen-content-types    → lib/content/content-types.generated.ts│  interna
        3. gen-facets           → db/schema/facets.generated.ts + FacetPort
        4. gen-zod              → lib/content/schemas.generated.ts      │  (dependências
        5. gen-ui-fields        → lib/content/ui-fields.generated.ts    │   abaixo)
        6. gen-theme            → app/theme.generated.css               │
        7. gen-nav              → lib/admin/nav.generated.ts            │
        8. gen-env              → .env.local  (git-ignored, último)     │
   ┌──────────────────────────────────────────────────────────────────┘
   └─(drizzle-kit generate)→ db/migrations/NNNN_*.sql
        └─(drizzle-kit migrate)→ schema aplicado no Postgres de CONTEÚDO (via DIRECT_URL)
```

**Dependências entre geradores (por que essa ordem):**
- `gen-enums` (1) antes de tudo no DB: o `content_type` enum precisa existir para `content.ts`/`drizzle-kit` verem.
- `gen-content-types` (2) antes de `gen-zod`/`gen-ui-fields`: eles referenciam o `ContentType` union.
- `gen-facets` (3) depende do enum (o `<type>_facets` referencia tipos válidos) — mas é independente de zod/ui.
- `gen-zod` (4) depende dos builders de S2.2 (`buildZodSchema` com os 6 atributos) — dep de story, não de gerador.
- `gen-theme` (6)/`gen-nav` (7) são independentes dos anteriores (só leem `branding`/`collections`).
- `gen-env` (8) SEMPRE por último (é o único que precisa de secrets do provisioning; e não afeta nenhum artefato TS/CSS).

**Na prática a ordem interna 3-7 é comutativa** exceto pela dependência de `gen-zod`/`gen-ui-fields` no `content-types` (2). A ordem canônica acima (a mesma de S2.6 T7 / S2.7 AC3) é a normativa.

### 4.2 Gatilhos no `package.json` do cliente (scripts)

```jsonc
{
  "scripts": {
    "generate":      "cms-core generate --config ./client.config.ts",
    "prebuild":      "npm run generate",       // antes de `next build` (Vercel)
    "predb:generate":"npm run generate",       // codegen SEMPRE antes do drizzle
    "db:generate":   "drizzle-kit generate",   // (já existe)
    "db:migrate":    "drizzle-kit migrate"     // (já existe)
  }
}
```

**Invariante:** `predb:generate` garante que `drizzle-kit generate` nunca roda sobre um schema TS defasado; `prebuild` garante que o Vercel builda com os `*.generated` frescos. O anti-drift (S2.4) é a CI rodando `generate` + `drizzle-kit check` = 0 diffs.

### 4.3 Onde os artefatos ficam + git

| Artefato | Local | Git |
|----------|-------|-----|
| `*.generated.ts` / `*.generated.css` | `clients/<slug>/` (dentro do workspace) | **commitado** (Vercel builda sem o CLI) + header `// AUTO-GERADO` + lint anti-edição |
| `db/migrations/*.sql` | `clients/<slug>/db/migrations/` | **commitado** (histórico versionado do schema) |
| `.env.local` | `clients/<slug>/` | **NUNCA** (`.gitignore: **/.env.local`) |
| tabelas-molde (`db/schema/{content,media,profiles,...}.ts`) | `clients/<slug>/` | **commitado** (não gerado; copiado no scaffold) |

### 4.4 Como o cliente consome tudo (`core-runtime.ts`)

O `lib/core-runtime.ts` é o ponto único de montagem (ADR-001/002). Pós-Fase-2 ele:
1. importa `clientConfig` de `@/client.config`;
2. importa `CONTENT_TYPES`/`SINGLETON_PAGES`/`SEGMENT_TO_TYPE` de `content-types.generated.ts` (via S2.3);
3. importa `schemas` de `schemas.generated.ts` (via S2.6/gen-zod) para os `behaviors`;
4. importa o `FacetPort` gerado de `facets.generated.ts` (via S2.5);
5. monta o `RegistryBundle` (builders da S2.1) e chama `createEngine({db,schema,audit,webhooks,facets,registry})` (ADR-002 §1);
6. re-exporta `validateContent`/`defForType`/`resolveTypeParam`/`SINGLETON_PAGES`/`SEGMENT_TO_TYPE`/`CONTENT_TYPES` para os ~20 call-sites.

O schema Drizzle (`db/schema/index.ts`) re-exporta `enums.generated.ts` + `facets.generated.ts` + as tabelas-molde, e o `db/index.ts` passa isso a `drizzle(client,{schema})`.

---

## 5. Materialização do workspace `cli/` (a pendência resolvida)

**Fato medido:** `pnpm-workspace.yaml` lista `cli`, o root `package.json` lista `"cli"` em workspaces, MAS o diretório `cli/` **não existe** (verificado: `ls cli` → ausente; `pnpm -r` só vê `packages/core` + `clients/demo-corp`). Isso é o pré-requisito que ADR-002 sinalizou e que S2.3 T0 já capturou.

### 5.1 Decisão: os geradores moram em `cli/`, NÃO em `packages/core`

| Opção | Onde os geradores vivem | Veredito |
|-------|-------------------------|----------|
| **(a) `cli/src/codegen/` (RECOMENDADA)** | workspace `cli/` (a fábrica), depende de `@cms-core/core` via `workspace:*` | **ESCOLHIDA** |
| (b) `packages/core/src/codegen/` | dentro do core | **REJEITADA** |
| (c) script solto no cliente | `clients/<slug>/scripts/` | **REJEITADA** |

**Por que (a):** os geradores são **ferramenta de build da fábrica** (operador), não runtime do CMS. Colocá-los no core (b) faria o pacote runtime carregar código de geração de arquivos (fs, template strings) que nenhum cliente executa em produção — inchaço + superfície. Além disso, a Fase 3 (CLI scaffolder) e Fase 4 (provisionamento) já moram em `cli/` (§8 do doc: `cli/src/{scaffold,codegen,provision,deploy}`); os geradores são o núcleo dessa CLI. O core **fornece** o vocabulário (`ClientConfig` types, os builders `buildZodSchemas`/`buildContentTypes`/etc.) que os geradores **consomem** — a dependência é `cli → @cms-core/core` (unidirecional, correta). (c) espalharia a lógica por cliente (contra D2/D1). **Decisão (a) confirma §8 do doc.**

### 5.2 API: `cms-core generate --config <path>` (comando de CLI)

- **Entrypoint:** `cli/src/codegen/run.ts` — parseia `--config`, carrega+valida o config (`validateClientConfig`), resolve o workspace-alvo (dir do config), roda os 8 geradores na ordem §4.1.
- **Bin:** `cli/package.json` declara `"bin": { "cms-core": "./dist/run.js" }` OU o script do cliente chama via `tsx`: `"generate": "tsx ../../cli/src/codegen/run.ts --config ./client.config.ts"`. **Recomendação:** na Fase 2, usar `tsx` direto (sem build step do CLI) para simplicidade; na Fase 3 empacotar o bin. Ambos funcionam com `workspace:*`.
- **Nome do pacote:** `"@cms-core/cli"` (escopo consistente com `@cms-core/core`), `private:true`, deps `@cms-core/core` (workspace:*), `zod`; dev `typescript`, `vitest`, `tsx`.

### 5.3 Materialização (T0 de S2.3 — normativo)

Criar, ANTES de S2.3 T1:
- `cli/package.json` (`@cms-core/cli`, private, deps acima).
- `cli/tsconfig.json` (extends root, `moduleResolution:"bundler"`).
- `cli/vitest.config.ts` (para os testes unitários dos geradores).
- `cli/src/codegen/run.ts` (esqueleto do entrypoint).
- registrar `cli` no `pnpm-workspace.yaml` (já listado — só confirmar `pnpm -r` passa a ver 3 workspaces após criar o `package.json`).

**Decisão de fronteira:** materializar o `cli/` é **T0 interno de S2.3** (NÃO uma micro-story S2.3a separada). Racional: é um setup de ~4 arquivos que só faz sentido junto do primeiro gerador (S2.3) — uma story só para `mkdir cli` seria overhead de processo. S2.3 já tem T0 modelado exatamente assim. Confirmo essa escolha.

---

## 6. Corte S2.1↔S2.2 e fronteiras entre stories

### 6.1 O corte S2.1↔S2.2 (onde vive `buildFieldSchema`)

**Estado medido no código:** `buildFieldSchema`/`buildZodSchema`/`buildZodSchemas` **JÁ existem** em `content-builders.ts` (l.235-328) — foram entregues em S2.1 como "esqueleto". `named-validators.ts` (`youtubeUrl`/`hexColor`) **também já entregue** em S2.1. Ou seja, o corte histórico (S2.1 = builders estruturais, S2.2 = regras finas de Zod) foi **borrado** na entrega: S2.1 entregou o esqueleto de zod também.

**Corte limpo recomendado (sem sobreposição):**

| Story | Responsabilidade ÚNICA | Artefatos |
|-------|------------------------|-----------|
| **S2.1** | (a) builders estruturais (`buildRegistry`/`buildFields`/`buildContentTypes`/`buildSingletonPages`/`buildSegmentToType`/`buildImagePolicies`/`buildEmptyData` — já entregues); (b) **seam do REGISTRY** (ADR-002 §1 — `RegistryBundle` injetado, `core-runtime.ts` monta, ~20 call-sites); (c) **baseline ganha os 6 atributos + `uiHidden`** (ADR-002 §2 + P3 deste ADR) por campo | `content-builders.ts` (structural), `di.ts`/`types.ts` (RegistryBundle), `core-runtime.ts`, `client.config.ts`+`demo-corp.config.ts` (atributos), `validate.ts` (fieldSchema +6+1 atributos) |
| **S2.2** | **APENAS o mapeamento fino `buildFieldSchema`** — os 6 atributos ADR-002 → Zod byte-idêntico (`default`/`trim`/`dedup`/`itemShape` + fix de precedência de `pattern` + `uiHidden` filter) + os validadores nomeados (já entregues, mas AC1 corrigido) | `content-builders.ts::buildFieldSchema` (o mapeamento), testes de identidade por campo |

**Regra de não-sobreposição:** S2.1 mexe na **ESTRUTURA** (que campos/coleções existem, como o registry é montado e injetado, quais atributos o baseline declara e o schema aceita). S2.2 mexe no **COMPORTAMENTO DE VALIDAÇÃO** (como cada atributo vira Zod). A fronteira é: S2.1 adiciona os atributos ao `FieldConfig`/`validate.ts`/baseline (vocabulário); S2.2 os traduz para Zod (semântica). O `buildFieldSchema` é de S2.2; o `fieldSchema` do `validate.ts` (que valida a forma dos atributos) é de S2.1.

**Ponto crítico do corte — `validate.ts::fieldSchema` está DESATUALIZADO:** medi que `validate.ts` l.93-114 (`fieldSchema`) **NÃO tem** os atributos `default`/`trim`/`dedup`/`itemShape` — tem só `name/label/kind/required/help/uploadField/validate`. E o `.strict()` (l.114) **rejeitaria** um baseline que declarasse `default:""` (chave desconhecida). **Portanto:** S2.1 DEVE estender `fieldSchema` com os 6 atributos ADR-002 + `uiHidden` ANTES de o baseline poder declará-los — senão `validateClientConfig` rejeita o próprio baseline. Este é um acoplamento de ordem dentro de S2.1 (estender o validador → depois adicionar atributos ao baseline). Registro como AC obrigatório de S2.1 em §8.

**Recomendação adicional (brandColor):** trocar o baseline de `validate:{pattern:...}` para `validate:{custom:"hexColor"}` no `brandColor` (§3.5). Elimina o ramo de "precedência de pattern em opcional" (frágil) reusando o `hexColor` já pronto. Isso simplifica `buildFieldSchema` (menos um caso especial). Decisão de S2.1 (baseline) + S2.2 (o mapeamento não precisa mais do fix de precedência para esse campo, mas mantém o ramo para robustez).

### 6.2 Demais fronteiras entre stories (cortes limpos)

- **S2.3 ↔ S2.5/S2.6:** S2.3 = `gen-enums`+`gen-content-types` + materialização `cli/` (T0). S2.5 = `gen-facets`+FacetPort. S2.6 = `gen-zod`+`gen-ui-fields`+`gen-theme`+`gen-nav`+rewires (orderable/email) + movência dos 3 editores para o core. S2.7 = `gen-env`+e2e. **Sem sobreposição de geradores** — cada gerador tem uma story dona única.
- **S2.4 (wire drizzle):** puramente de pipeline (`predb:generate` + anti-drift CI) — não tem gerador próprio; costura S2.3→drizzle. Corte limpo.
- **`gen-zod` (S2.6) depende de `buildZodSchema` (S2.2):** S2.6 assume S2.2 completo (é `dep` transitiva). O `gen-zod` NÃO reimplementa o mapeamento; só serializa `buildZodSchemas(config)`. Sem sobreposição.
- **Movência dos editores (S2.6 ACs 13-16):** é escopo de UI ortogonal ao codegen; convive na mesma story por afinidade de R4 (branding/UI). Já validado GO pelo @po (0.6). Não mexo.

---

## 7. Tipos fortes garantidos no build (D2) + continuidade do gate S0.3/TEST-001

### 7.1 Cadeia de tipos fortes (medida)

1. **Enum como fonte única:** `contentTypeEnum` (Postgres, `gen-enums`) e `CONTENT_TYPES as const` (TS, `gen-content-types`) saem do MESMO `collections[].type`. `type ContentType = typeof CONTENT_TYPES[number]` propaga o union literal. Medi: o `schema-shape.ts` do core declara `type` como `text` (Port genérico), mas o cliente usa `pgEnum` concreto — a atribuição estrutural funciona (ambos inferem `string` em `$inferSelect`; o cast na fronteira em `core-runtime.ts` l.156 já absorve a variação de `columnType`). O union forte vive na borda (cliente), como ADR-001 §6.5 travou.
2. **Zod ↔ TS alinhados:** `buildZodSchema(fields)` produz o schema cujo `z.infer` É o tipo do `data`. Como `gen-zod` importa o config e chama `buildZodSchemas(config)` (não reconstrói texto), o `z.infer` é automático e correto.
3. **Drizzle tipado:** `facets.generated.ts` são `pgTable` reais → `$inferSelect`/`$inferInsert` funcionam; `db/schema/index.ts` os re-exporta e o `drizzle-kit` os vê.
4. **Barreira anti-drift (S2.4):** CI roda `cms-core generate` + `drizzle-kit check`; divergência config↔migrations reprova o build.

### 7.2 Continuidade do gate S0.3/TEST-001 (`toEqual`) — como cada gerador o preserva

O TEST-001 (`toEqual`) prova `buildRegistry`/`buildFields`/`buildContentTypes`/enum derivados == literais gold-standard (core 82/82 verde). **Cada gerador preserva o gate assim:**

- `gen-enums`/`gen-content-types`: emitem o output de builders JÁ cobertos por TEST-001. Se o builder passa, o gerado passa. ✅
- `gen-zod`: após S2.2 (6 atributos), `buildZodSchemas(config)` é byte-idêntico aos 9 schemas gold (novo TEST-001 de identidade de schema, por campo). O `gen-zod` serializa esse output → herda a identidade. **Depende de P3** (filtrar `uiHidden` senão `case` tem campo a mais). ✅ com P3.
- `gen-ui-fields`: `buildFields`+`buildEmptyData` cobertos por TEST-001. **Depende de P3** (filtrar `industryFacets` do `FIELDS`). ✅ com P3.
- `gen-facets`: AC8 exige `drizzle-kit check` = 0 diffs (o gate de identidade do schema DB). ✅
- `gen-theme`/`gen-nav`: não cobertos por TEST-001 (não são mapas do motor); o gate é visual/e2e (S2.7). A byte-identidade do `theme.generated.css` depende de **corrigir os valores de exemplo do baseline** (§3.7) — senão há regressão visual (não quebra teste, mas quebra o gold-standard visual). Registro como AC de S2.1.
- `gen-env`: não commitado, não comparado — fora do TEST-001. Coberto por unit test próprio (Supabase :6543 / Neon -pooler / sslmode).

**Invariante do gate:** todo gerador que produz um artefato coberto por TEST-001 ou `drizzle-kit check` NÃO pode ser considerado done sem esses verdes. S2.7 é o gate agregado do Marco 2.

### 7.3 Regras de determinismo (normativas — evitam diffs espúrios)

- **D1 — ordem de chaves preservada, NUNCA alfabetizada.** Todo serializador de objeto (`REGISTRY`, `SEGMENT_TO_TYPE`, `SINGLETON_PAGES`, `FIELDS`) emite chaves na ordem de inserção do config (ordem do array `collections` / `Object.entries` de `singletonRoutes`). Um `Object.keys().sort()` no serializador introduziria diff espúrio vs o gold (que segue ordem de declaração).
- **D2 — arrays na ordem do config.** Colunas de facet, campos de `FIELDS`, tipos do enum — ordem do array, sem reordenação.
- **D3 — Zod via runtime-call, não serialização textual.** `schemas.generated.ts` faz `export const schemas = buildZodSchemas(config)` (S2.6 T2). Elimina divergência de serialização e torna a identidade automática.
- **D4 — sem timestamps/hashes voláteis nos headers.** O header `// AUTO-GERADO por cms-core generate — não editar` é fixo (sem data/hash), senão todo run produz diff no git.
- **D5 — formatação estável.** O gerador emite código já no estilo do projeto (ou roda `prettier`/`eslint --fix` no output) para não gerar diffs de formatação vs o commitado. Recomendo o gerador emitir e depois `eslint --fix` o arquivo gerado (ou usar um template com a formatação canônica).

---

## 8. Ajustes de story (o que muda, e o que o @po re-valida)

> Regra: stories com mudança **material** de AC voltam a **Draft** (re-validação @po). Correções de premissa/path/nota sem mudar AC mantêm o status.

| Story | Mudança deste ADR | Δ status | @po re-valida? |
|-------|-------------------|----------|----------------|
| **S2.1** | (1) AC novo: `validate.ts::fieldSchema` estende com os **6 atributos ADR-002 + `uiHidden`** ANTES do baseline declará-los (senão `.strict()` rejeita o baseline). (2) AC novo: baseline `demo-corp.config.ts`+`client.config.ts` marcam `industryFacets` com `uiHidden:true` (P3). (3) AC novo: **corrigir os valores de exemplo do baseline** (`ink:#373234`,`muted:#6b6b6b`,`paper:#f3f3f3`,`brandDarker:#94291f`) para os reais do gold (§3.7). (4) `brandColor` do baseline → `validate:{custom:"hexColor"}` (§6.1). (5) `orderable` propagado ao `ContentTypeDef`/`RegistryBundle` (§3.10-nota). | já **Draft** (ADR-002) | **SIM** — já estava para re-validar; estes ACs se somam |
| **S2.2** | (1) AC1: o mapeamento `buildFieldSchema` inclui o **filtro `uiHidden`** (pula campos ocultos) — além dos 6 atributos ADR-002. (2) nota: o fix de precedência de `pattern` fica opcional se o baseline usar `custom:"hexColor"` (mantido por robustez). | já **Draft** (ADR-002) | **SIM** — já estava para re-validar |
| **S2.3** | Confirmar: materialização `cli/` = **T0 interno** (não S2.3a) — decisão travada (§5.3). API `cms-core generate` = `@cms-core/cli` + `tsx` na Fase 2 (§5.2). Sem mudança de AC. | mantém **Ready** | não (confirma T0 existente) |
| **S2.5** | Sem mudança material. Nota: o `FacetPort` tem **5 métodos** (`extract`/`upsert`/`filter`/`read`/`listFiltered`) — o gerado deve cobrir os 5 (o AC4 cita 3; **corrigir para 5** ou referenciar `di.ts`). Rename `case_study_facets`→`case_facets` já em AC8. | AC4 → **Draft** (correção material: 3→5 métodos) | **SIM** — AC4 subestima o FacetPort real |
| **S2.6** | (1) `gen-ui-fields`/`gen-zod` **filtram `uiHidden`** (P3) — AC novo. (2) `gen-theme` emite SÓ as 6 cores+font; resto é template estático (§3.7) — clarificação de AC3 (já implícito). (3) `gen-nav`: label = `collection.label`, divergência cosmética de pluralização aceita (§3.8) — nota em AC4. (4) `orderable` lido de `def.orderable` (depende do ajuste S2.1 #5). | AC1/AC2 → **Draft** (filtro `uiHidden` é material) | **SIM** — filtro `uiHidden` afeta o output gerado |
| **S2.7** | Sem mudança. `gen-env` medido e confirmado (§3.9). D5 Supabase/Neon OK. | mantém **Ready** | não |
| **S2.4** | Sem mudança. Anti-drift confirmado. | mantém **Ready** | não |

**Resumo para o @po re-validar: S2.1, S2.2, S2.5, S2.6** (4 stories). S2.3/S2.4/S2.7 mantêm Ready.

---

## 9. Riscos residuais do codegen + mitigações

| ID | Risco | Prob/Impacto | Mitigação |
|----|-------|--------------|-----------|
| R-P3 | `uiHidden` (ou o fallback `kind:"facets"` skip) não filtra corretamente → `case` tem campo a mais no `FIELDS`/schema → TEST-001 quebra | Média/Alto | TEST-001 pega imediatamente; a extensão é testável (fixture com/sem `uiHidden`). Fallback (b) sem contrato disponível. |
| R-theme | valores de exemplo do baseline ≠ gold real → `theme.generated.css` causa regressão visual (não pega em unit test) | Média/Médio | AC de S2.1 corrige os 4 valores; e2e visual em S2.7; snapshot do `@theme` no gerador |
| R-nav | divergência cosmética "Case study" vs "Case studies" / colapso `/pages` | Baixa/Baixo | aceita como não-funcional; e2e navega por href; se @po exigir paridade textual, `navLabel?` é follow-up mínimo (NÃO recomendado agora) |
| R-facet-rename | migration `case_study_facets`→`case_facets` mal-feita → perda de dados / drift | Baixa/Alto | S2.5 AC8/T7 exige migration de rename explícita + `drizzle-kit check`=0; rename preserva dados (ALTER TABLE RENAME) |
| R-zod-serial | `gen-zod` reconstruir `z.object(...)` textualmente → divergência do gold | Baixa/Alto | D3 normativo: `gen-zod` chama `buildZodSchemas(config)` em runtime, NÃO serializa texto |
| R-order | serializador alfabetiza chaves → diff espúrio vs gold | Média/Médio | D1/D2 normativos: ordem de inserção preservada; TEST-001 pega |
| R-cli-tsx | `tsx` no `generate` do cliente com `workspace:*` não resolve `@cms-core/core` no Vercel | Baixa/Alto | os `*.generated` são commitados → o Vercel NÃO roda `generate` no build (o `prebuild` roda, mas os arquivos já existem; se `tsx` falhar, o build usa os commitados). Alternativa: empacotar o bin do CLI na Fase 3. |
| R-drift | `*.generated` editado à mão diverge do config | Baixa/Médio | header `AUTO-GERADO` + lint anti-edição + CI `generate`+`check` (S2.4) |
| R-neon-fk | `gen-facets`/molde não omitir a FK `authUsers` no caso Neon (D5) → `CREATE ... auth.users` falha | Baixa/Alto (só Neon) | §13.4 do doc: `profiles` molde condicional em `database.kind`; é escopo D5/Fase 5, não Fase 2 (Demo Corp é Supabase) |

**Nenhum desses riscos é um problema de DESIGN aberto** — todos têm mitigação conhecida e a maioria é pega por TEST-001/`drizzle-kit check`/e2e. É por isso que a probabilidade de um 3º spike é baixa: o contrato está fechado (§0), e o que resta é execução guardada por gates.

---

## 10. Ações de acompanhamento

- **@sm re-drafta/ajusta** conforme §8: **S2.1** (ACs `uiHidden`+atributos no `validate.ts`+valores de tema+`orderable`), **S2.2** (filtro `uiHidden` no mapeamento), **S2.5** (AC4: FacetPort 5 métodos), **S2.6** (filtro `uiHidden` em `gen-ui-fields`/`gen-zod`; notas theme/nav). Deixar S2.1/S2.2/S2.5/S2.6 em **Draft** para re-validação.
- **@po re-valida** S2.1, S2.2, S2.5, S2.6.
- **@dev** materializa o `cli/` como T0 de S2.3 (§5.3) antes do 1º gerador.
- **Atualizações do doc de arquitetura** (nesta mesma passada): §4.1 (`uiHidden?` no `FieldConfig`), §6 (design de codegen consolidado + decomposição theme/nav + `gen-drizzle-core` = scaffold-copy + `cli/`), §6.2 (tabela de geradores + `uiHidden`), Changelog (2026-08-03).

---

## Apêndice — Classificação completa dos 8 arquivos `db/schema/` (evidência de P1)

| Arquivo | Tabelas/objetos | Config-driven | Gerador / origem |
|---------|-----------------|---------------|------------------|
| `enums.ts` | `roleEnum`, `userStatusEnum`, `contentTypeEnum`, `contentStatusEnum` | só `contentTypeEnum` | `gen-enums` (o resto: estático do core) |
| `content.ts` | `contentEntries`, `contentVersions`, `caseStudyFacets` | só `caseStudyFacets` (vira `case_facets`) | núcleo = molde fixo; facets = `gen-facets` |
| `media.ts` | `mediaAssets` | não | molde fixo |
| `profiles.ts` | `profiles` (+ FK `authUsers`) | não (FK condicional em Neon — D5) | molde fixo; FK condicional |
| `audit.ts` | `auditLog` | não | molde fixo |
| `webhooks.ts` | `webhookEndpoints` | não | molde fixo |
| `locales.ts` | `locales` | não | molde fixo |
| `leads.ts` | `leads` | não | molde fixo |
| `index.ts` | re-export barrel | — | re-exporta molde + `enums.generated` + `facets.generated` |

**Conclusão de P1:** de 8 arquivos, **0 são "gerados por inteiro a partir do config"**; **2 têm uma peça gerada** (`content_type` enum, `case_facets`); **6 são molde fixo**. `gen-drizzle-schema` como "gerador config-driven das tabelas" NÃO existe e NÃO deve existir — a integridade do Port (ADR-001) depende disso.
