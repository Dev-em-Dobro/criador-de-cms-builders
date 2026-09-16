// S2.1 — PROVA DE IDENTIDADE FORTE (TEST-001) + testes dos content builders (R1).
//
// Converte o snapshot AUTO-REFERENCIAL do S0.3 numa prova de identidade contra
// âncoras EXTERNAS: os literais reais do motor de conteúdo do Demo Corp
// (capturados em __fixtures__/demo-corp-expected.ts). Os builders DEVEM
// produzir EXATAMENTE esses literais — `toEqual`, não `toBeDefined`.
//
// Cobre: buildContentRegistry (estrutura), buildFields, buildContentTypes,
// buildSingletonPages, buildSegmentToType, buildEmptyData, buildImagePolicies,
// buildZodSchema (esqueleto + regras finas: pattern, youtubeUrl, hexColor).

import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  buildContentRegistry,
  buildContentTypes,
  buildFields,
  buildSingletonPages,
  buildSegmentToType,
  buildEmptyData,
  buildImagePolicies,
  buildZodSchema,
  buildZodSchemas,
  buildFieldSchema,
  registeredValidatorNames,
  type ContentTypeBehavior,
} from "../index.js";
import type { FieldConfig } from "../types.js";
import { demoCorpConfig } from "../../../../../templates/config-examples/demo-corp.config.js";
import {
  caseSchema,
  solutionSchema,
  personSchema,
  regionSchema,
  insightSchema,
  page5hSchema,
  pageBookSchema,
  pageAwardsSchema,
  pageLegalSchema,
} from "../../engine/types.js";
import {
  EXPECTED_CONTENT_TYPES,
  EXPECTED_REGISTRY,
  EXPECTED_FIELDS,
  EXPECTED_SINGLETON_PAGES,
  EXPECTED_SEGMENT_TO_TYPE,
  EXPECTED_EMPTY_DATA,
  EXPECTED_IMAGE_POLICIES,
} from "./fixtures/demo-corp-expected.js";

// Behaviors stub para buildContentRegistry (o motor injeta os reais; aqui só
// precisamos de placeholders para provar a ESTRUTURA derivada do config).
function stubBehaviors(): Record<string, ContentTypeBehavior> {
  const out: Record<string, ContentTypeBehavior> = {};
  for (const t of EXPECTED_CONTENT_TYPES) {
    out[t] = {
      schema: z.object({}).passthrough() as z.ZodType<Record<string, unknown>>,
      toListItem: (d) => ({ title: String(d.title ?? "") }),
    };
  }
  return out;
}

// ── CONTENT_TYPES ────────────────────────────────────────────────────────────
describe("S2.1 — buildContentTypes (identidade forte)", () => {
  it("iguala CONTENT_TYPES do motor (mesma ordem)", () => {
    expect(buildContentTypes(demoCorpConfig)).toEqual([
      ...EXPECTED_CONTENT_TYPES,
    ]);
  });
});

// ── REGISTRY (estrutura) ─────────────────────────────────────────────────────
describe("S2.1 — buildContentRegistry (identidade forte, TEST-001)", () => {
  const registry = buildContentRegistry(demoCorpConfig, stubBehaviors());

  it("estrutura (type/label/segment/singleton) iguala o REGISTRY real do motor", () => {
    const structural = Object.fromEntries(
      Object.entries(registry).map(([k, v]) => [
        k,
        {
          type: v.type,
          label: v.label,
          segment: v.segment,
          singleton: v.singleton,
        },
      ]),
    );
    expect(structural).toEqual(EXPECTED_REGISTRY);
  });

  it("chaves na mesma ordem/presença que CONTENT_TYPES", () => {
    expect(Object.keys(registry)).toEqual([...EXPECTED_CONTENT_TYPES]);
  });

  it("singletons têm segment undefined; coleções têm segment", () => {
    expect(registry.page_5h.singleton).toBe(true);
    expect(registry.page_5h.segment).toBeUndefined();
    expect(registry.case.singleton).toBe(false);
    expect(registry.case.segment).toBe("cases");
    expect(registry.person.segment).toBe("people");
  });

  it("fail-fast se faltar behavior para um tipo", () => {
    const partial = { ...stubBehaviors() };
    delete partial.case;
    expect(() => buildContentRegistry(demoCorpConfig, partial)).toThrow(
      /missing behavior.*case/,
    );
  });
});

// ── FIELDS (identidade forte) ────────────────────────────────────────────────
describe("S2.1 — buildFields (identidade forte, TEST-001)", () => {
  it("iguala o FIELDS real do motor (byte-a-byte, incl. omissão de chaves opcionais)", () => {
    expect(buildFields(demoCorpConfig)).toEqual(EXPECTED_FIELDS);
  });

  it("chaves opcionais só presentes quando declaradas (required/help/uploadField)", () => {
    const fields = buildFields(demoCorpConfig);
    // tags: sem required/help/uploadField
    expect(fields.case[0]).toEqual({
      name: "tags",
      label: "Tags",
      kind: "stringList",
    });
    // logoMediaId: com uploadField + help, sem required
    const logo = fields.case.find((f) => f.name === "logoMediaId");
    expect(logo).toEqual({
      name: "logoMediaId",
      label: "Brand logo",
      kind: "media",
      uploadField: "logo",
      help: "Transparent PNG, up to 1024×1024",
    });
  });

  it("buildFields omite `validate` (paridade com FieldSpec do motor)", () => {
    const youtube = buildFields(demoCorpConfig).case.find(
      (f) => f.name === "youtube",
    );
    expect(youtube).not.toHaveProperty("validate");
  });
});

// ── SINGLETON_PAGES / SEGMENT_TO_TYPE ────────────────────────────────────────
describe("S2.1 — roteamento derivado do config (identidade forte)", () => {
  it("buildSingletonPages iguala SINGLETON_PAGES do motor", () => {
    expect(buildSingletonPages(demoCorpConfig)).toEqual(
      EXPECTED_SINGLETON_PAGES,
    );
  });

  it("page_legal produz 3 rotas (privacy/cookies/terms)", () => {
    const pages = buildSingletonPages(demoCorpConfig);
    expect(pages.privacy).toEqual({ type: "page_legal", slug: "privacy" });
    expect(pages.cookies).toEqual({ type: "page_legal", slug: "cookies" });
    expect(pages.terms).toEqual({ type: "page_legal", slug: "terms" });
  });

  it("buildSegmentToType iguala SEGMENT_TO_TYPE do motor (só coleções não-singleton)", () => {
    expect(buildSegmentToType(demoCorpConfig)).toEqual(
      EXPECTED_SEGMENT_TO_TYPE,
    );
  });
});

// ── emptyData ────────────────────────────────────────────────────────────────
describe("S2.1 — buildEmptyData (identidade forte)", () => {
  it("case: stringList→[], facets→grupos, resto→''", () => {
    expect(buildEmptyData(demoCorpConfig, "case")).toEqual(
      EXPECTED_EMPTY_DATA.case,
    );
  });

  it("page_awards: json→[]", () => {
    expect(buildEmptyData(demoCorpConfig, "page_awards")).toEqual(
      EXPECTED_EMPTY_DATA.page_awards,
    );
  });
});

// ── IMAGE_POLICIES ───────────────────────────────────────────────────────────
describe("S2.1 — buildImagePolicies (identidade forte)", () => {
  it("iguala IMAGE_POLICIES do motor (logo + banner)", () => {
    expect(buildImagePolicies(demoCorpConfig)).toEqual(
      EXPECTED_IMAGE_POLICIES,
    );
  });
});

// ── buildZodSchema (esqueleto + regras finas) ────────────────────────────────
describe("S2.1 — buildZodSchema (mapeamento kind → Zod, §5 R1)", () => {
  it("text required → rejeita vazio; opcional → aceita ausente", () => {
    const schema = buildZodSchema([
      { name: "title", label: "T", kind: "text", required: true },
      { name: "quote", label: "Q", kind: "text" },
    ]);
    expect(schema.safeParse({ title: "x" }).success).toBe(true);
    expect(schema.safeParse({ title: "" }).success).toBe(false);
  });

  it("url opcional aceita '' (blank = não provido) e URL válida; rejeita lixo", () => {
    const s = buildFieldSchema({ name: "u", label: "U", kind: "url" });
    expect(s.safeParse("").success).toBe(true);
    expect(s.safeParse("https://x.com").success).toBe(true);
    expect(s.safeParse("not-a-url").success).toBe(false);
  });

  it("stringList default [] quando ausente", () => {
    const schema = buildZodSchema([
      { name: "tags", label: "T", kind: "stringList" },
    ]);
    const r = schema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) expect((r.data as { tags: string[] }).tags).toEqual([]);
  });

  it("validate.pattern → .regex() (brandColor hex)", () => {
    const s = buildFieldSchema({
      name: "brandColor",
      label: "C",
      kind: "text",
      validate: { pattern: "^#([0-9a-fA-F]{6})$" },
    });
    expect(s.safeParse("#d84339").success).toBe(true);
    expect(s.safeParse("xyz").success).toBe(false);
  });

  it("validate.custom: youtubeUrl aceita os 4 formatos e rejeita não-YouTube", () => {
    const s = buildFieldSchema({
      name: "youtube",
      label: "Y",
      kind: "url",
      validate: { custom: "youtubeUrl" },
    });
    for (const ok of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ",
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
      "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    ]) {
      expect(s.safeParse(ok).success, ok).toBe(true);
    }
    expect(s.safeParse("https://vimeo.com/12345").success).toBe(false);
    // blank = não provido
    expect(s.safeParse("").success).toBe(true);
  });

  it("validate.custom: hexColor aceita #RRGGBB e rejeita o resto; blank ok", () => {
    const s = buildFieldSchema({
      name: "c",
      label: "C",
      kind: "text",
      validate: { custom: "hexColor" },
    });
    expect(s.safeParse("#AABBCC").success).toBe(true);
    expect(s.safeParse("#1A2b3C").success).toBe(true);
    expect(s.safeParse("GGG").success).toBe(false);
    expect(s.safeParse("#GGGGGG").success).toBe(false);
    expect(s.safeParse("AABBCC").success).toBe(false);
    expect(s.safeParse("").success).toBe(true);
  });

  it("validate.custom desconhecido → fail-fast na geração", () => {
    expect(() =>
      buildFieldSchema({
        name: "x",
        label: "X",
        kind: "text",
        validate: { custom: "naoExiste" },
      } as FieldConfig),
    ).toThrow(/Unknown named validator/);
  });

  it("registry pré-registra youtubeUrl e hexColor", () => {
    expect(registeredValidatorNames()).toEqual(["hexColor", "youtubeUrl"]);
  });
});

// ── S2.2 — mapeamento fino dos atributos ADR-002 §2 (buildFieldSchema) ────────
describe("S2.2 — atributos estendidos do FieldConfig → Zod (ADR-002 §2)", () => {
  it("default:'' (text sem required) → z.string().default('') — dado volta ''", () => {
    const s = buildFieldSchema({
      name: "quote",
      label: "Q",
      kind: "text",
      default: "",
    });
    const r = s.safeParse(undefined);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBe("");
  });

  it("sem default e sem required (text) → optional() — dado volta undefined", () => {
    const s = buildFieldSchema({ name: "ctaLabel", label: "C", kind: "text" });
    const r = s.safeParse(undefined);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBeUndefined();
  });

  it("trim+dedup (stringList) → tagsField: apara, remove brancos, de-dupe, default []", () => {
    const s = buildFieldSchema({
      name: "tags",
      label: "T",
      kind: "stringList",
      trim: true,
      dedup: true,
    });
    const r = s.safeParse([" strategy ", "strategy", "", "  ", "M&A"]);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toEqual(["strategy", "M&A"]);
    const empty = s.safeParse(undefined);
    if (empty.success) expect(empty.data).toEqual([]);
  });

  it("default:[] (stringList sem dedup) → array(string()).default([]) — não normaliza", () => {
    const s = buildFieldSchema({
      name: "addressLines",
      label: "A",
      kind: "stringList",
      default: [],
    });
    const r = s.safeParse([" a ", " a "]);
    // sem trim/dedup, mantém como veio (duplicados/espaços preservados).
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toEqual([" a ", " a "]);
  });

  it("itemShape (json array-of-objects): key/title required, description default('')", () => {
    const s = buildFieldSchema({
      name: "elements",
      label: "E",
      kind: "json",
      itemShape: {
        key: { kind: "text", required: true },
        title: { kind: "text", required: true },
        description: { kind: "text", default: "" },
      },
    });
    const ok = s.safeParse([{ key: "k", title: "t" }]);
    expect(ok.success).toBe(true);
    if (ok.success)
      expect((ok.data as Array<Record<string, unknown>>)[0].description).toBe(
        "",
      );
    // key vazio (min1) → inválido.
    expect(s.safeParse([{ key: "", title: "t" }]).success).toBe(false);
    // ausente → default [].
    const empty = s.safeParse(undefined);
    if (empty.success) expect(empty.data).toEqual([]);
  });

  it("itemShape com media opcional (page_awards items): name required, logoMediaId uuid optional", () => {
    const s = buildFieldSchema({
      name: "items",
      label: "I",
      kind: "json",
      itemShape: {
        name: { kind: "text", required: true },
        year: { kind: "text" },
        logoMediaId: { kind: "media" },
      },
    });
    expect(
      s.safeParse([
        { name: "n", logoMediaId: "11111111-1111-4111-8111-111111111111" },
      ]).success,
    ).toBe(true);
    expect(s.safeParse([{ year: "2020" }]).success).toBe(false); // name required
    expect(s.safeParse([{ name: "n", logoMediaId: "not-a-uuid" }]).success).toBe(
      false,
    );
  });

  it("url required → z.url() estrita (purchaseUrl)", () => {
    const s = buildFieldSchema({
      name: "purchaseUrl",
      label: "P",
      kind: "url",
      required: true,
    });
    expect(s.safeParse("https://x.com").success).toBe(true);
    expect(s.safeParse("").success).toBe(false);
    expect(s.safeParse(undefined).success).toBe(false);
  });

  it("email opcional → optionalEmail (blank = não provido)", () => {
    const s = buildFieldSchema({ name: "email", label: "E", kind: "email" });
    expect(s.safeParse("").success).toBe(true);
    expect(s.safeParse("a@b.com").success).toBe(true);
    expect(s.safeParse("not-an-email").success).toBe(false);
  });

  it("media opcional → z.uuid().optional()", () => {
    const s = buildFieldSchema({ name: "photo", label: "P", kind: "media" });
    expect(
      s.safeParse("11111111-1111-4111-8111-111111111111").success,
    ).toBe(true);
    expect(s.safeParse(undefined).success).toBe(true);
    expect(s.safeParse("nope").success).toBe(false);
  });

  it("date opcional → z.string().optional() (não datetime)", () => {
    const s = buildFieldSchema({ name: "d", label: "D", kind: "date" });
    expect(s.safeParse("2024-01-01").success).toBe(true);
    expect(s.safeParse(undefined).success).toBe(true);
  });

  it("uiHidden é filtrado do z.object (buildZodSchema)", () => {
    const schema = buildZodSchema([
      { name: "title", label: "T", kind: "text", required: true },
      { name: "industryFacets", label: "F", kind: "facets", uiHidden: true },
    ]);
    const r = schema.safeParse({ title: "x" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).not.toHaveProperty("industryFacets");
  });
});

// ── Prova de identidade FORTE de schema (AC13) — buildZodSchemas == gold ──────
// Compara o resultado de parse do schema GERADO (buildZodSchemas) com o schema
// gold-standard hand-written (engine/types.ts) para payloads representativos que
// exercitam TODOS os atributos ADR-002: default("") observável, tags
// trim/dedup/default([]), itemShape (elements/items), url requerida/opcional,
// media opcional, brandColor via hexColor, youtube. `toEqual` de outputs = prova
// byte-idêntica do comportamento de validação.
describe("S2.1/S2.2 — buildZodSchemas identidade de schema (AC13)", () => {
  const gen = buildZodSchemas(demoCorpConfig);
  const gold = {
    case: caseSchema,
    solution: solutionSchema,
    person: personSchema,
    region: regionSchema,
    insight: insightSchema,
    page_5h: page5hSchema,
    page_book: pageBookSchema,
    page_awards: pageAwardsSchema,
    page_legal: pageLegalSchema,
  } as const;

  // Payloads representativos por tipo (mínimo + variações que exercitam defaults).
  const payloads: Record<string, unknown[]> = {
    case: [
      { title: "T" },
      {
        title: "T",
        tags: [" a ", "a", "", "b"],
        quote: "q",
        brandColor: "#1A2b3C",
        youtube: "https://youtu.be/dQw4w9WgXcQ",
        logoMediaId: "11111111-1111-4111-8111-111111111111",
      },
      { title: "T", brandColor: "" },
      { quote: "no title" }, // inválido (title required)
      { title: "T", mutedVideoUrl: "not-a-url" }, // inválido
    ],
    solution: [
      { title: "T", problemStatement: "P" },
      { problemStatement: "P" }, // inválido
    ],
    person: [
      { name: "N", role: "R", bio: "B" },
      { name: "N", role: "R", bio: "B", linkedin: "", email: "" },
      { name: "N", role: "R", bio: "B", email: "not-an-email" }, // inválido
    ],
    region: [
      { name: "N", city: "C" },
      { name: "N", city: "C", country: "BR", addressLines: ["l1", "l2"] },
    ],
    insight: [
      { title: "T", body: "B" },
      { title: "T", body: "B", tags: [" x ", "x"], publishedDate: "2024-01-01" },
    ],
    page_5h: [
      { title: "T" },
      {
        title: "T",
        elements: [{ key: "k", title: "t" }],
        youtube: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      },
      { title: "T", elements: [{ key: "" }] }, // inválido (key min1, title required)
    ],
    page_book: [
      { title: "T", description: "D", purchaseUrl: "https://x.com" },
      { title: "T", description: "D" }, // inválido (purchaseUrl required)
    ],
    page_awards: [
      { title: "T" },
      {
        title: "T",
        items: [
          {
            name: "n",
            year: "2020",
            logoMediaId: "11111111-1111-4111-8111-111111111111",
          },
        ],
      },
      { title: "T", items: [{ year: "2020" }] }, // inválido (name required)
    ],
    page_legal: [{ title: "T", body: "B" }, { title: "T" }],
  };

  for (const [type, samples] of Object.entries(payloads)) {
    it(`${type}: parse do schema gerado === schema gold (byte-idêntico)`, () => {
      const genSchema = gen[type];
      const goldSchema = gold[type as keyof typeof gold];
      for (const sample of samples) {
        const g = genSchema.safeParse(sample);
        const h = goldSchema.safeParse(sample);
        expect(g.success, `${type} ${JSON.stringify(sample)}`).toBe(h.success);
        if (g.success && h.success) {
          expect(g.data).toEqual(h.data);
        }
      }
    });
  }
});
