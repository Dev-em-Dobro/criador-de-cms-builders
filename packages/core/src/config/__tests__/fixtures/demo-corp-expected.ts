// TEST-001 — fixtures de PROVA DE IDENTIDADE FORTE (S2.1, AC5).
//
// Estes objetos são CAPTURADOS VERBATIM dos literais REAIS do motor de conteúdo
// do Demo Corp, que na Fase 1 (S1.3) foram extraídos para o core em
// `packages/core/src/engine/`:
//   - EXPECTED_FIELDS       ← packages/core/src/engine/ui-fields.ts :: FIELDS
//   - EXPECTED_REGISTRY     ← packages/core/src/engine/types.ts     :: REGISTRY
//                             (subconjunto estrutural type/label/segment/singleton;
//                              `schema`/`toListItem` são runtime — provados à parte
//                              via comportamento em builders.test.ts)
//   - EXPECTED_SINGLETON_PAGES ← packages/core/src/engine/types.ts :: SINGLETON_PAGES
//   - EXPECTED_SEGMENT_TO_TYPE  ← packages/core/src/engine/types.ts :: SEGMENT_TO_TYPE
//   - EXPECTED_EMPTY_DATA    ← packages/core/src/engine/ui-fields.ts :: emptyData(type)
//
// Data da captura: 2026-08-03 (a partir do estado pós-S1.3b do engine do core).
//
// PROPÓSITO (dívida TEST-001): converter o snapshot AUTO-REFERENCIAL do S0.3
// (`toMatchSnapshot`, que qualquer builder que compile passa) numa PROVA DE
// IDENTIDADE contra uma âncora externa. `buildRegistry(config)` /
// `buildFields(config)` DEVEM produzir EXATAMENTE estes literais — qualquer
// divergência (label errado, campo faltando, ordem trocada) quebra o `toEqual`.
//
// IMPORTANTE (correção @po, [[cms-factory-equivalence-fixtures]]): copiar os
// literais como fixtures embutidas — NÃO importar `REGISTRY`/`FIELDS` do engine
// diretamente. Um import direto tornaria o teste auto-referencial de novo (o
// builder passaria a ser comparado com a fonte que ele deve substituir, e uma
// regressão simultânea nos dois passaria despercebida). A âncora tem de ser
// independente e capturada à mão.

import type { FieldSpec } from "../../builders.js";

/**
 * ← engine/types.ts :: CONTENT_TYPES (ordem canônica do enum content_type).
 */
export const EXPECTED_CONTENT_TYPES = [
  "case",
  "solution",
  "person",
  "region",
  "insight",
  "page_5h",
  "page_book",
  "page_awards",
  "page_legal",
] as const;

/**
 * ← engine/types.ts :: REGISTRY (subconjunto estrutural type/label/segment/
 * singleton, na ordem de inserção). Singletons têm `segment: undefined`.
 */
export const EXPECTED_REGISTRY: Record<
  string,
  { type: string; label: string; segment?: string; singleton: boolean }
> = {
  case: { type: "case", label: "Case study", segment: "cases", singleton: false },
  solution: {
    type: "solution",
    label: "Solution",
    segment: "solutions",
    singleton: false,
  },
  person: { type: "person", label: "Person", segment: "people", singleton: false },
  region: { type: "region", label: "Region", segment: "regions", singleton: false },
  insight: {
    type: "insight",
    label: "Insight",
    segment: "insights",
    singleton: false,
  },
  page_5h: {
    type: "page_5h",
    label: "5H Framework page",
    segment: undefined,
    singleton: true,
  },
  page_book: {
    type: "page_book",
    label: "Book page",
    segment: undefined,
    singleton: true,
  },
  page_awards: {
    type: "page_awards",
    label: "Awards & partnerships",
    segment: undefined,
    singleton: true,
  },
  page_legal: {
    type: "page_legal",
    label: "Legal page",
    segment: undefined,
    singleton: true,
  },
};

/**
 * ← engine/types.ts :: SINGLETON_PAGES. Chave lógica de rota → { type, slug }.
 * Derivado do `singletonRoutes` de cada coleção singleton do config.
 */
export const EXPECTED_SINGLETON_PAGES: Record<
  string,
  { type: string; slug: string }
> = {
  "5h": { type: "page_5h", slug: "5h" },
  book: { type: "page_book", slug: "book" },
  awards: { type: "page_awards", slug: "awards" },
  privacy: { type: "page_legal", slug: "privacy" },
  cookies: { type: "page_legal", slug: "cookies" },
  terms: { type: "page_legal", slug: "terms" },
};

/**
 * ← engine/types.ts :: SEGMENT_TO_TYPE. Segmento plural → type (só coleções
 * não-singleton com `segment`).
 */
export const EXPECTED_SEGMENT_TO_TYPE: Record<string, string> = {
  cases: "case",
  solutions: "solution",
  people: "person",
  regions: "region",
  insights: "insight",
};

/**
 * ← engine/ui-fields.ts :: FIELDS (por tipo, ordem preservada). As chaves
 * opcionais (`required`/`help`/`uploadField`) só aparecem quando presentes no
 * literal do modelo — o builder DEVE reproduzir essa omissão condicional.
 *
 * NOTA (ADR-003 P3, AC15): o `industryFacets` (kind:"facets") existe no CONFIG
 * baseline (@po fix #2, alvo dos FacetConfig.sourceField) mas está marcado
 * `uiHidden:true` — NÃO entra no `FIELDS` gold-standard (que tem 10 campos em
 * `case`). `buildFields` FILTRA campos `uiHidden`, então `EXPECTED_FIELDS.case`
 * reproduz o FIELDS real do motor (10 campos, sem `industryFacets`). Isto é a
 * prova de identidade forte: byte-idêntico ao `engine/ui-fields.ts::FIELDS`.
 */
export const EXPECTED_FIELDS: Record<string, FieldSpec[]> = {
  case: [
    { name: "tags", label: "Tags", kind: "stringList" },
    { name: "title", label: "Page title", kind: "text", required: true },
    { name: "quote", label: "Quote", kind: "textarea" },
    { name: "quoter", label: "Quoter", kind: "text" },
    {
      name: "mutedVideoUrl",
      label: "Interview video (URL)",
      kind: "url",
      help: "Video that autoplays without sound",
    },
    {
      name: "youtube",
      label: "YouTube video (URL)",
      kind: "url",
      help: "watch / youtu.be / embed / shorts link",
    },
    {
      name: "brandColor",
      label: "Brand colour",
      kind: "text",
      help: "6-digit hex, e.g. #1a2b3c (leave blank to use the default)",
    },
    {
      name: "logoMediaId",
      label: "Brand logo",
      kind: "media",
      uploadField: "logo",
      help: "Transparent PNG, up to 1024×1024",
    },
    { name: "introduction", label: "Introduction", kind: "richtext" },
    { name: "text", label: "Text", kind: "richtext" },
    // `industryFacets` (uiHidden:true) é FILTRADO — não entra no FIELDS gold.
  ],
  solution: [
    { name: "title", label: "Title", kind: "text", required: true },
    {
      name: "bannerMediaId",
      label: "Banner background image",
      kind: "media",
      uploadField: "banner",
      help: "Background image for the banner",
    },
    {
      name: "problemStatement",
      label: "Problem statement",
      kind: "richtext",
      required: true,
    },
    { name: "body", label: "Body", kind: "richtext" },
  ],
  person: [
    { name: "name", label: "Name", kind: "text", required: true },
    { name: "role", label: "Role", kind: "text", required: true },
    { name: "bio", label: "Bio", kind: "richtext", required: true },
    { name: "photoMediaId", label: "Photo", kind: "media" },
    { name: "regionSlug", label: "Region slug", kind: "text" },
    { name: "linkedin", label: "LinkedIn URL", kind: "url" },
    { name: "instagram", label: "Instagram URL", kind: "url" },
    { name: "facebook", label: "Facebook URL", kind: "url" },
    { name: "x", label: "X (Twitter) URL", kind: "url" },
    { name: "email", label: "Email", kind: "email" },
  ],
  region: [
    { name: "name", label: "Name", kind: "text", required: true },
    { name: "city", label: "City", kind: "text", required: true },
    { name: "country", label: "Country", kind: "text" },
    { name: "summary", label: "Summary", kind: "richtext" },
    { name: "addressLines", label: "Address lines", kind: "stringList" },
  ],
  insight: [
    { name: "tags", label: "Tags", kind: "stringList" },
    { name: "title", label: "Title", kind: "text", required: true },
    {
      name: "author",
      label: "Author",
      kind: "text",
      help: "Shown as “By …” on the insight",
    },
    { name: "excerpt", label: "Excerpt", kind: "richtext" },
    { name: "body", label: "Body", kind: "richtext", required: true },
    { name: "coverMediaId", label: "Cover image", kind: "media" },
    {
      name: "youtube",
      label: "YouTube video (URL)",
      kind: "url",
      help: "watch / youtu.be / embed / shorts link",
    },
    { name: "publishedDate", label: "Published date", kind: "date" },
  ],
  page_5h: [
    { name: "title", label: "Title", kind: "text", required: true },
    { name: "intro", label: "Intro", kind: "richtext" },
    {
      name: "elements",
      label: "Elements [ {key,title,description} ]",
      kind: "json",
    },
    {
      name: "youtube",
      label: "YouTube video (URL)",
      kind: "url",
      help: "watch / youtu.be / embed / shorts link",
    },
    { name: "ctaLabel", label: "CTA label", kind: "text" },
    { name: "ctaHref", label: "CTA href", kind: "text" },
  ],
  page_book: [
    { name: "title", label: "Title", kind: "text", required: true },
    {
      name: "description",
      label: "Description",
      kind: "richtext",
      required: true,
    },
    { name: "coverMediaId", label: "Cover image", kind: "media" },
    {
      name: "youtube",
      label: "YouTube video (URL)",
      kind: "url",
      help: "watch / youtu.be / embed / shorts link",
    },
    { name: "purchaseUrl", label: "Purchase URL", kind: "url", required: true },
  ],
  page_awards: [
    { name: "title", label: "Title", kind: "text", required: true },
    { name: "items", label: "Items [ {name,year,logoMediaId} ]", kind: "json" },
  ],
  page_legal: [
    { name: "title", label: "Title", kind: "text", required: true },
    { name: "body", label: "Body", kind: "richtext", required: true },
  ],
};

/**
 * ← engine/ui-fields.ts :: emptyData(type). Valores padrão iniciais por kind.
 * Amostra dos tipos com kinds distintos (stringList→[], json→[], facets→objeto
 * de grupos, default→"").
 */
export const EXPECTED_EMPTY_DATA: Record<
  string,
  Record<string, unknown>
> = {
  // `industryFacets` (uiHidden:true) é filtrado — o `emptyData(case)` gold tem
  // 10 chaves (o campo facets é tratado à parte pelo FacetsInput no editor).
  case: {
    tags: [],
    title: "",
    quote: "",
    quoter: "",
    mutedVideoUrl: "",
    youtube: "",
    brandColor: "",
    logoMediaId: "",
    introduction: "",
    text: "",
  },
  page_awards: {
    title: "",
    items: [],
  },
};

/**
 * ← engine/media/policies.ts :: IMAGE_POLICIES. Deriva de config.uploadPolicies.
 */
export const EXPECTED_IMAGE_POLICIES = {
  logo: {
    label: "Logo",
    formats: ["image/png"],
    requireAlpha: true,
    preserveFormat: true,
    maxBytes: 2 * 1024 * 1024,
    maxWidth: 1024,
    maxHeight: 1024,
  },
  banner: {
    label: "Banner",
    aspectRatio: { w: 16, h: 9, tolerance: 0.05 },
    maxBytes: 8 * 1024 * 1024,
  },
} as const;
