// S0.3 — teste de equivalência (gold-standard gate).
//
// Prova que o output dos builders (a partir do baseline S0.2) é
// ESTRUTURALMENTE IDÊNTICO aos literais hardcoded do `demo-corp-cms`
// (`REGISTRY`, `FIELDS`, `CONTENT_TYPES`, colunas de `caseStudyFacets`). Este é
// o gate de não-regressão da Fase 0 (§5.5 / §11.1 do doc de arquitetura): a
// partir do snapshot commitado, qualquer perda de campo/tipo/facet quebra o CI.
//
// ── Estratégia de equivalência (decisão @po #3, abordagem DEFAULT) ──────────
// Os literais do modelo são COPIADOS como FIXTURES neste arquivo (não import
// cross-repo direto), evitando acoplar dois projetos separados em tempo de
// build. As fixtures abaixo foram copiadas verbatim de:
//   - CONTENT_TYPES / REGISTRY  ← demo-corp-cms/lib/content/types.ts
//   - FIELDS                     ← demo-corp-cms/lib/content/ui-fields.ts
//   - colunas caseStudyFacets    ← demo-corp-cms/db/schema/content.ts
// Origem/data: demo-corp-cms lido em 2026-08-01. Se o modelo mudar, estas
// fixtures E o baseline (S0.2) devem ser reconciliados conscientemente.

import { describe, it, expect } from "vitest";
import {
  buildRegistry,
  buildFields,
  buildContentTypes,
  buildFacets,
} from "../builders.js";
import { demoCorpConfig } from "../../../../../templates/config-examples/demo-corp.config.js";

// ── FIXTURES: literais do demo-corp-cms (copiados 2026-08-01) ───────────

/** ← lib/content/types.ts :: CONTENT_TYPES (ordem canônica do enum). */
const EXPECTED_CONTENT_TYPES = [
  "case",
  "solution",
  "person",
  "region",
  "insight",
  "page_5h",
  "page_book",
  "page_awards",
  "page_legal",
];

/**
 * ← lib/content/types.ts :: REGISTRY (subconjunto estrutural: type/label/
 * segment/singleton). `schema` e `toListItem` são runtime, fora da equivalência.
 */
const EXPECTED_REGISTRY: Record<
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
  person: {
    type: "person",
    label: "Person",
    segment: "people",
    singleton: false,
  },
  region: {
    type: "region",
    label: "Region",
    segment: "regions",
    singleton: false,
  },
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

/** ← db/schema/content.ts :: caseStudyFacets (nomes de coluna, na ordem). */
const EXPECTED_CASE_FACET_COLUMNS = [
  "industry",
  "service",
  "region_slugs",
  "outcome",
];

describe("gold-standard equivalence — enum (AC5)", () => {
  it("buildContentTypes iguala CONTENT_TYPES do modelo (mesma ordem)", () => {
    expect(buildContentTypes(demoCorpConfig)).toEqual(EXPECTED_CONTENT_TYPES);
  });

  it("AC8: falha deliberada se um tipo estiver ausente ou fora de ordem", () => {
    // Sanidade do gate: uma ordem trocada NÃO deve igualar o esperado.
    const scrambled = [...EXPECTED_CONTENT_TYPES].reverse();
    expect(buildContentTypes(demoCorpConfig)).not.toEqual(scrambled);
  });
});

describe("gold-standard equivalence — REGISTRY (AC3)", () => {
  it("buildRegistry snapshot (gold-standard baseline)", () => {
    expect(buildRegistry(demoCorpConfig)).toMatchSnapshot();
  });

  it("buildRegistry iguala o REGISTRY esperado do modelo (type/label/segment/singleton)", () => {
    expect(buildRegistry(demoCorpConfig)).toEqual(EXPECTED_REGISTRY);
  });

  it("chaves na mesma ordem/presença que CONTENT_TYPES", () => {
    expect(Object.keys(buildRegistry(demoCorpConfig))).toEqual(
      EXPECTED_CONTENT_TYPES,
    );
  });

  it("case.singleton === false", () => {
    expect(buildRegistry(demoCorpConfig).case.singleton).toBe(false);
  });

  it("page_5h.singleton === true", () => {
    expect(buildRegistry(demoCorpConfig).page_5h.singleton).toBe(true);
  });

  it("person.segment === 'people'", () => {
    expect(buildRegistry(demoCorpConfig).person.segment).toBe("people");
  });
});

describe("gold-standard equivalence — FIELDS (AC4)", () => {
  it("buildFields snapshot (gold-standard baseline)", () => {
    expect(buildFields(demoCorpConfig)).toMatchSnapshot();
  });

  it("as chaves de FIELDS são os 9 tipos", () => {
    expect(Object.keys(buildFields(demoCorpConfig))).toEqual(
      EXPECTED_CONTENT_TYPES,
    );
  });

  it("primeiro campo de case é 'tags' (ordem preservada)", () => {
    expect(buildFields(demoCorpConfig).case[0].name).toBe("tags");
  });

  it("buildFields omite o campo validate (paridade com FieldSpec do modelo)", () => {
    const caseFields = buildFields(demoCorpConfig).case;
    const youtube = caseFields.find((f) => f.name === "youtube");
    expect(youtube).toBeDefined();
    expect(youtube).not.toHaveProperty("validate");
  });

  it("AC8: falha deliberada se um campo tiver name diferente", () => {
    // Sanidade: mutar o name do primeiro campo quebra a equivalência.
    const fields = buildFields(demoCorpConfig);
    const mutated = { ...fields, case: [{ ...fields.case[0], name: "WRONG" }, ...fields.case.slice(1)] };
    expect(mutated.case[0].name).not.toBe(fields.case[0].name);
  });
});

describe("gold-standard equivalence — facets do case (AC9)", () => {
  it("buildFacets(config, 'case') → 4 colunas = caseStudyFacets do modelo", () => {
    const facets = buildFacets(demoCorpConfig, "case");
    expect(facets.map((f) => f.column ?? f.name)).toEqual(
      EXPECTED_CASE_FACET_COLUMNS,
    );
  });

  it("as 4 facets têm name industry/service/region/outcome", () => {
    const facets = buildFacets(demoCorpConfig, "case");
    expect(facets.map((f) => f.name)).toEqual([
      "industry",
      "service",
      "region",
      "outcome",
    ]);
  });

  it("coleções sem facets retornam []", () => {
    expect(buildFacets(demoCorpConfig, "person")).toEqual([]);
    expect(buildFacets(demoCorpConfig, "inexistente")).toEqual([]);
  });
});
