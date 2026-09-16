// templates/config-examples/demo-corp.config.ts
//
// Baseline gold-standard (S0.2): reproduz FIELMENTE os 9 content types do
// `demo-corp-cms` — todos os campos, facets e políticas de upload — no
// formato do contrato ClientConfig (S0.1). Serve de input para o teste de
// equivalência (S0.3) que compara o output dos builders contra os literais
// hardcoded do CMS-modelo.
//
// Artigo IV (No Invention): todos os campos, tipos, facets e políticas derivam
// diretamente dos arquivos abaixo do `demo-corp-cms` (SOMENTE LEITURA):
//   - lib/content/ui-fields.ts    → FIELDS por tipo (name, label, kind, required, uploadField, help)
//   - lib/content/types.ts        → REGISTRY (label, segment, singleton), SINGLETON_PAGES, CONTENT_TYPES (ordem)
//   - db/schema/enums.ts          → contentTypeEnum (9 tipos, ordem canônica)
//   - db/schema/content.ts        → caseStudyFacets (industry, service, region_slugs, outcome)
//   - lib/media/policies.ts       → IMAGE_POLICIES (logo, banner)
//
// Origem/data da leitura de referência: demo-corp-cms lido em 2026-08-01.
//
// Correções do @po absorvidas nesta baseline:
//   1. `orderable: true` APENAS em `person` (o REGISTRY do modelo NÃO marca
//      `case` como orderable — o drag-and-drop é hardcoded via type==="person").
//   2. `case` ganha um campo `kind:"facets"` (`industryFacets`) e os 4
//      FacetConfig.sourceField apontam para ele, para passar em
//      validateClientConfig (regra AC6 de S0.1). Ancorado em §4.1 (nota
//      facets-kind vs FacetConfig) e §4.3 (exemplo acme).

import type { ClientConfig } from "@cms-core/core/config";

export const demoCorpConfig: ClientConfig = {
  slug: "demo-corp",
  displayName: "Demo Corp",
  coreVersion: "^1.0.0",

  branding: {
    // Cores REAIS do gold-standard (`app/globals.css` @theme). Corrigidas p/ bater
    // com o tema atual — ADR-003 §3.7/AC16 (senão o theme.generated.css de S2.6
    // diverge do globals.css e causa regressão visual). O baseline usa o
    // single-provider Supabase, o caso mais simples (§10 S0.2, AC10/AC11).
    adminTitle: "Demo Corp",
    fontFamily: "Poppins",
    colors: {
      brand: "#d84339",
      brandDark: "#b5342b",
      brandDarker: "#94291f",
      ink: "#373234",
      muted: "#6b6b6b",
      paper: "#f3f3f3",
    },
  },

  domains: {
    adminSubdomain: "cms.example.com",
    siteUrl: "https://www.example.com",
  },

  providers: {
    // Baseline = single-provider Supabase (auth.region === database.region, D5).
    database: { kind: "supabase", region: "sa-east-1", plan: "free" },
    auth: { provider: "supabase", region: "sa-east-1", plan: "free" },
    media: {
      provider: "bunny",
      storageZone: "demo-corp-media",
      storageRegion: "BR",
      cdnUrl: "https://demo-corp.b-cdn.net",
    },
    email: {
      provider: "resend",
      senderDomain: "example.com",
      fromName: "Demo Corp CMS",
    },
    hosting: { provider: "vercel", projectName: "demo-corp-cms", framework: "nextjs" },
  },

  locales: {
    // Espelha o CMS atual (pt-BR + en). O default do modelo é en; aqui usamos
    // pt-BR como default, ambos habilitados (AC11).
    default: "pt-BR",
    enabled: [
      { code: "pt-BR", label: "Português" },
      { code: "en", label: "English" },
    ],
  },

  // ── Coleções e singletons — ORDEM CANÔNICA de CONTENT_TYPES do modelo ──────
  // case, solution, person, region, insight, page_5h, page_book, page_awards, page_legal
  collections: [
    // ── 1. case (listável, com facets) ────────────────────────────────────
    // REGISTRY: label "Case study", segment "cases", singleton false.
    // FIELDS["case"]: tags, title, quote, quoter, mutedVideoUrl, youtube,
    //   brandColor, logoMediaId, introduction, text.
    // @po fix #1: case NÃO é orderable (REGISTRY do modelo não marca).
    {
      type: "case",
      label: "Case study",
      segment: "cases",
      fields: [
        // tags → tagsField (trim+dedup+default([])) — ADR-002 Apêndice A.
        { name: "tags", label: "Tags", kind: "stringList", trim: true, dedup: true },
        { name: "title", label: "Page title", kind: "text", required: true },
        { name: "quote", label: "Quote", kind: "textarea", default: "" },
        { name: "quoter", label: "Quoter", kind: "text", default: "" },
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
          // AC8: validador nomeado youtubeUrl (registrado no core em S2.2).
          validate: { custom: "youtubeUrl" },
        },
        {
          name: "brandColor",
          label: "Brand colour",
          kind: "text",
          help: "6-digit hex, e.g. #1a2b3c (leave blank to use the default)",
          // ADR-003 §3.5/AC16: reusa o `hexColor` de named-validators (produz o
          // `brandColorField` gold: preprocess ""→undefined + regex + optional).
          validate: { custom: "hexColor" },
        },
        {
          name: "logoMediaId",
          label: "Brand logo",
          kind: "media",
          uploadField: "logo",
          help: "Transparent PNG, up to 1024×1024",
        },
        { name: "introduction", label: "Introduction", kind: "richtext", default: "" },
        { name: "text", label: "Text", kind: "richtext", default: "" },
        // @po fix #2: campo kind:"facets" que alimenta as 4 facets promovidas.
        // No modelo, `emptyData` inicializa o campo `facets` com os grupos
        // industry/service/region/outcome — aqui é declarado como um campo de UI
        // `kind:"facets"` para que os FacetConfig.sourceField tenham alvo válido.
        // ADR-003 P3/AC15: `uiHidden` para NÃO vazar p/ FIELDS/schema gold
        // (o gold tem 10 campos em `case`, sem `industryFacets`).
        { name: "industryFacets", label: "Classification", kind: "facets", uiHidden: true },
      ],
      // AC5: 4 facets espelhando as colunas de caseStudyFacets do modelo
      // (industry, service, region_slugs, outcome). column = nome exato da
      // coluna Postgres; sourceField = campo kind:"facets" (@po fix #2).
      facets: [
        { name: "industry", column: "industry", sourceField: "industryFacets" },
        { name: "service", column: "service", sourceField: "industryFacets" },
        { name: "region", column: "region_slugs", sourceField: "industryFacets" },
        { name: "outcome", column: "outcome", sourceField: "industryFacets" },
      ],
    },

    // ── 2. solution ───────────────────────────────────────────────────────
    // REGISTRY: label "Solution", segment "solutions".
    // FIELDS["solution"]: title, bannerMediaId, problemStatement, body.
    {
      type: "solution",
      label: "Solution",
      segment: "solutions",
      fields: [
        { name: "title", label: "Title", kind: "text", required: true },
        {
          name: "bannerMediaId",
          label: "Banner background image",
          kind: "media",
          // AC7: banner usa a política "banner".
          uploadField: "banner",
          help: "Background image for the banner",
        },
        {
          name: "problemStatement",
          label: "Problem statement",
          kind: "richtext",
          required: true,
        },
        { name: "body", label: "Body", kind: "richtext", default: "" },
      ],
    },

    // ── 3. person (orderable) ─────────────────────────────────────────────
    // REGISTRY: label "Person", segment "people".
    // FIELDS["person"]: name, role, bio, photoMediaId, regionSlug, linkedin,
    //   instagram, facebook, x, email.
    // @po fix #1: person É orderable (generaliza o hardcoded type==="person").
    {
      type: "person",
      label: "Person",
      segment: "people",
      orderable: true,
      fields: [
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
    },

    // ── 4. region ─────────────────────────────────────────────────────────
    // REGISTRY: label "Region", segment "regions".
    // FIELDS["region"]: name, city, country, summary, addressLines.
    {
      type: "region",
      label: "Region",
      segment: "regions",
      fields: [
        { name: "name", label: "Name", kind: "text", required: true },
        { name: "city", label: "City", kind: "text", required: true },
        { name: "country", label: "Country", kind: "text", default: "" },
        { name: "summary", label: "Summary", kind: "richtext", default: "" },
        // addressLines → array(string()).default([]) sem dedup (ADR-002 §2).
        { name: "addressLines", label: "Address lines", kind: "stringList", default: [] },
      ],
    },

    // ── 5. insight ────────────────────────────────────────────────────────
    // REGISTRY: label "Insight", segment "insights".
    // FIELDS["insight"]: tags, title, author, excerpt, body, coverMediaId,
    //   youtube, publishedDate.
    {
      type: "insight",
      label: "Insight",
      segment: "insights",
      fields: [
        { name: "tags", label: "Tags", kind: "stringList", trim: true, dedup: true },
        { name: "title", label: "Title", kind: "text", required: true },
        {
          name: "author",
          label: "Author",
          kind: "text",
          help: "Shown as “By …” on the insight",
          default: "",
        },
        { name: "excerpt", label: "Excerpt", kind: "richtext", default: "" },
        { name: "body", label: "Body", kind: "richtext", required: true },
        { name: "coverMediaId", label: "Cover image", kind: "media" },
        {
          name: "youtube",
          label: "YouTube video (URL)",
          kind: "url",
          help: "watch / youtu.be / embed / shorts link",
          validate: { custom: "youtubeUrl" },
        },
        { name: "publishedDate", label: "Published date", kind: "date" },
      ],
    },

    // ── 6. page_5h (singleton) ────────────────────────────────────────────
    // REGISTRY: label "5H Framework page", singleton true.
    // SINGLETON_PAGES: "5h" → { type: page_5h, slug: "5h" }.
    // FIELDS["page_5h"]: title, intro, elements, youtube, ctaLabel, ctaHref.
    {
      type: "page_5h",
      label: "5H Framework page",
      singleton: true,
      singletonRoutes: { "5h": "5h" },
      fields: [
        { name: "title", label: "Title", kind: "text", required: true },
        { name: "intro", label: "Intro", kind: "richtext", default: "" },
        {
          name: "elements",
          label: "Elements [ {key,title,description} ]",
          kind: "json",
          // gold: array(object({key:min1,title:min1,description:default("")})).default([])
          itemShape: {
            key: { kind: "text", required: true },
            title: { kind: "text", required: true },
            description: { kind: "text", default: "" },
          },
        },
        {
          name: "youtube",
          label: "YouTube video (URL)",
          kind: "url",
          help: "watch / youtu.be / embed / shorts link",
          validate: { custom: "youtubeUrl" },
        },
        { name: "ctaLabel", label: "CTA label", kind: "text" },
        { name: "ctaHref", label: "CTA href", kind: "text" },
      ],
    },

    // ── 7. page_book (singleton) ──────────────────────────────────────────
    // REGISTRY: label "Book page", singleton true.
    // SINGLETON_PAGES: "book" → { type: page_book, slug: "book" }.
    // FIELDS["page_book"]: title, description, coverMediaId, youtube, purchaseUrl.
    {
      type: "page_book",
      label: "Book page",
      singleton: true,
      singletonRoutes: { book: "book" },
      fields: [
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
          validate: { custom: "youtubeUrl" },
        },
        { name: "purchaseUrl", label: "Purchase URL", kind: "url", required: true },
      ],
    },

    // ── 8. page_awards (singleton) ────────────────────────────────────────
    // REGISTRY: label "Awards & partnerships", singleton true.
    // SINGLETON_PAGES: "awards" → { type: page_awards, slug: "awards" }.
    // FIELDS["page_awards"]: title, items.
    {
      type: "page_awards",
      label: "Awards & partnerships",
      singleton: true,
      singletonRoutes: { awards: "awards" },
      fields: [
        { name: "title", label: "Title", kind: "text", required: true },
        {
          name: "items",
          label: "Items [ {name,year,logoMediaId} ]",
          kind: "json",
          // gold: array(object({name:min1,year:optional,logoMediaId:uuid optional})).default([])
          itemShape: {
            name: { kind: "text", required: true },
            year: { kind: "text" },
            logoMediaId: { kind: "media" },
          },
        },
      ],
    },

    // ── 9. page_legal (singleton, múltiplas rotas) ────────────────────────
    // REGISTRY: label "Legal page", singleton true.
    // SINGLETON_PAGES: privacy, cookies, terms → { type: page_legal, slug: <key> }.
    // FIELDS["page_legal"]: title, body.
    {
      type: "page_legal",
      label: "Legal page",
      singleton: true,
      singletonRoutes: { privacy: "privacy", cookies: "cookies", terms: "terms" },
      fields: [
        { name: "title", label: "Title", kind: "text", required: true },
        { name: "body", label: "Body", kind: "richtext", required: true },
      ],
    },
  ],

  // ── Políticas de upload — paridade com IMAGE_POLICIES do modelo ───────────
  uploadPolicies: {
    logo: {
      label: "Logo",
      formats: ["image/png"],
      requireAlpha: true,
      preserveFormat: true,
      maxBytes: 2_097_152, // 2 * 1024 * 1024
      maxWidth: 1024,
      maxHeight: 1024,
    },
    banner: {
      label: "Banner",
      aspectRatio: { w: 16, h: 9, tolerance: 0.05 },
      maxBytes: 8_388_608, // 8 * 1024 * 1024
    },
  },

  seedAdmin: { email: "admin@example.com", passwordEnvVar: "SEED_ADMIN_PASSWORD" },
  seeds: { enabled: false },
};
