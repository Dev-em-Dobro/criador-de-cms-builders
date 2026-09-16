// S0.2 — teste de validação (smoke) do baseline do Demo Corp.
//
// Prova que o config baseline reproduz os 9 content types e passa em
// `validateClientConfig` (AC2). A verificação profunda de equivalência de campos
// e facets é responsabilidade do S0.3 (snapshot test).

import { describe, it, expect } from "vitest";
import { validateClientConfig } from "../validate.js";
import { demoCorpConfig } from "../../../../../templates/config-examples/demo-corp.config.js";

// Ordem canônica de CONTENT_TYPES do modelo (db/schema/enums.ts).
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

describe("S0.2 — demo-corp baseline", () => {
  it("AC2: validateClientConfig(demoCorpConfig) não lança", () => {
    expect(() => validateClientConfig(demoCorpConfig)).not.toThrow();
  });

  it("tem exatamente 9 coleções (5 listáveis + 4 singletons)", () => {
    expect(demoCorpConfig.collections).toHaveLength(9);
  });

  it("os tipos estão na mesma ordem que CONTENT_TYPES do modelo", () => {
    expect(demoCorpConfig.collections.map((c) => c.type)).toEqual(
      EXPECTED_CONTENT_TYPES,
    );
  });

  it("o tipo 'case' tem 4 facets", () => {
    const caseCol = demoCorpConfig.collections.find((c) => c.type === "case");
    expect(caseCol?.facets).toHaveLength(4);
  });

  it("uploadPolicies tem 'logo' e 'banner'", () => {
    expect(demoCorpConfig.uploadPolicies.logo).toBeDefined();
    expect(demoCorpConfig.uploadPolicies.banner).toBeDefined();
  });

  it("@po fix #1: person é orderable; case NÃO é orderable", () => {
    const person = demoCorpConfig.collections.find((c) => c.type === "person");
    const caseCol = demoCorpConfig.collections.find((c) => c.type === "case");
    expect(person?.orderable).toBe(true);
    expect(caseCol?.orderable).toBeUndefined();
  });

  it("@po fix #2: as 4 facets de case apontam para o campo kind:'facets' industryFacets", () => {
    const caseCol = demoCorpConfig.collections.find((c) => c.type === "case");
    const facetField = caseCol?.fields.find((f) => f.kind === "facets");
    expect(facetField?.name).toBe("industryFacets");
    for (const facet of caseCol?.facets ?? []) {
      expect(facet.sourceField).toBe("industryFacets");
    }
  });

  it("as colunas das facets de case espelham caseStudyFacets do modelo", () => {
    const caseCol = demoCorpConfig.collections.find((c) => c.type === "case");
    expect(caseCol?.facets?.map((f) => f.column)).toEqual([
      "industry",
      "service",
      "region_slugs",
      "outcome",
    ]);
  });
});
