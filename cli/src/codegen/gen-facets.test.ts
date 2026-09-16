// S2.5 — testes do gerador gen-facets (schema <type>_facets + FacetPort gerado).
//
// Prova: (1) o baseline Demo Corp gera `case_facets` byte-estruturalmente
// equivalente ao `caseStudyFacets` gold (4 colunas + 4 índices GIN + rename
// region→region_slugs); (2) a generalização SEM código específico via um
// config-fixture ISOLADO (coleção fictícia `blog`) — AC7/T6; (3) o baseline real
// (insight sem facets) NÃO gera `insight_facets`.

import { describe, it, expect } from "vitest";
import type { ClientConfig } from "@cms-core/core/config";
import {
  renderFacets,
  facetedCollections,
  columnProp,
  tableConst,
} from "./gen-facets.js";
import { demoCorpConfig } from "../../../templates/config-examples/demo-corp.config.js";

// Fixture ISOLADO (AC7): estende o baseline com uma 2ª coleção `blog` que declara
// um facet `tag`. NÃO muta o baseline em disco — é local ao teste. Prova que uma
// nova coleção com facets funciona sem NENHUMA linha de código específica.
const blogConfig: ClientConfig = {
  ...demoCorpConfig,
  collections: [
    ...demoCorpConfig.collections,
    {
      type: "blog",
      label: "Blog post",
      segment: "blog",
      fields: [
        { name: "title", label: "Title", kind: "text", required: true },
        { name: "tagFacets", label: "Tags", kind: "facets", uiHidden: true },
      ],
      facets: [{ name: "tag", column: "tags", sourceField: "tagFacets" }],
    },
  ],
};

describe("gen-facets — helpers", () => {
  it("columnProp converte snake_case → camelCase", () => {
    expect(columnProp("region_slugs")).toBe("regionSlugs");
    expect(columnProp("industry")).toBe("industry");
    expect(columnProp("tags")).toBe("tags");
  });

  it("tableConst deriva a constante da tabela do type", () => {
    expect(tableConst("case")).toBe("caseFacets");
    expect(tableConst("blog")).toBe("blogFacets");
    expect(tableConst("page_legal")).toBe("pageLegalFacets");
  });

  it("facetedCollections retorna só coleções com facets, na ordem do config", () => {
    const fc = facetedCollections(demoCorpConfig);
    expect(fc.map((c) => c.type)).toEqual(["case"]);
    expect(fc[0].facets.map((f) => f.name)).toEqual([
      "industry",
      "service",
      "region",
      "outcome",
    ]);
    // rename region → region_slugs (o ponto crítico do gold).
    const region = fc[0].facets.find((f) => f.name === "region")!;
    expect(region.column).toBe("region_slugs");
    expect(region.prop).toBe("regionSlugs");
  });
});

describe("gen-facets — baseline Demo Corp (case_facets)", () => {
  const out = renderFacets(demoCorpConfig);

  it("header AUTO-GERADO na primeira linha", () => {
    expect(out.split("\n")[0]).toBe(
      "// AUTO-GERADO por cms-core generate — não editar",
    );
  });

  it("gera a tabela case_facets (rename de case_study_facets)", () => {
    expect(out).toContain('export const caseFacets = pgTable(');
    expect(out).toContain('"case_facets",');
  });

  it("PK entryId → contentEntries.id onDelete cascade (1:1, sem coluna id)", () => {
    expect(out).toContain('entryId: uuid("entry_id")');
    expect(out).toContain(".primaryKey()");
    expect(out).toContain(
      '.references(() => contentEntries.id, { onDelete: "cascade" }),',
    );
    // NÃO inventa uma coluna `id` separada — o gold usa entryId como PK.
    expect(out).not.toContain('id: uuid("id")');
  });

  it("as 4 colunas text[] NOT NULL default '{}' na ordem do config", () => {
    for (const col of ["industry", "service", "region_slugs", "outcome"]) {
      expect(out).toContain(
        `text("${col}").array().notNull().default(sql\`'{}'::text[]\`)`,
      );
    }
    // ordem preservada (industry, service, region_slugs, outcome).
    const idxs = ["industry", "service", "region_slugs", "outcome"].map((c) =>
      out.indexOf(`text("${c}")`),
    );
    expect(idxs).toEqual([...idxs].sort((a, b) => a - b));
  });

  it("um índice GIN por coluna de facet (4 índices, nomes por coluna)", () => {
    expect(out).toContain(
      'index("case_facets_industry_idx").using("gin", caseFacets.industry)',
    );
    expect(out).toContain(
      'index("case_facets_service_idx").using("gin", caseFacets.service)',
    );
    expect(out).toContain(
      'index("case_facets_region_slugs_idx").using("gin", caseFacets.regionSlugs)',
    );
    expect(out).toContain(
      'index("case_facets_outcome_idx").using("gin", caseFacets.outcome)',
    );
  });

  it("NÃO gera insight_facets (insight do baseline não tem facets — S0.3)", () => {
    expect(out).not.toContain("insight_facets");
    expect(out).not.toContain("insightFacets");
  });

  it("importa as deps de drizzle + o FacetPort do core", () => {
    expect(out).toContain(
      'import { and, arrayOverlaps, desc, eq, sql, type SQL } from "drizzle-orm";',
    );
    expect(out).toContain(
      'import { index, pgTable, text, uuid } from "drizzle-orm/pg-core";',
    );
    expect(out).toContain(
      'import type { FacetPort } from "@cms-core/core/engine";',
    );
    expect(out).toContain('import { contentEntries } from "./content";');
  });

  it("é determinístico (mesmo config → mesmo output)", () => {
    expect(renderFacets(demoCorpConfig)).toBe(out);
  });
});

describe("gen-facets — FacetPort gerado (5 métodos, equivalência com o manual)", () => {
  const out = renderFacets(demoCorpConfig);

  it("exporta um facetPort com os 5 métodos", () => {
    expect(out).toContain("export const facetPort: FacetPort = {");
    expect(out).toContain("extract(type, data) {");
    expect(out).toContain("async upsert(tx, type, entryId, facets) {");
    expect(out).toContain("filter(type, params) {");
    expect(out).toContain("async read(db, type, entryId) {");
    expect(out).toContain(
      "async listFiltered(db, type, baseConds, params, paging) {",
    );
  });

  it("extract lê data.facets e mapeia p/ columnProps (byte-equiv extractCaseFacets)", () => {
    // fonte = data.facets (NÃO data.industryFacets) — equivalência com o gold.
    expect(out).toContain(
      "const f = (data.facets ?? {}) as Record<string, string[] | undefined>;",
    );
    // region (facet.name) → regionSlugs (columnProp).
    expect(out).toContain('regionSlugs: f["region"] ?? [],');
    expect(out).toContain('industry: f["industry"] ?? [],');
    expect(out).toContain('outcome: f["outcome"] ?? [],');
  });

  it("filter mapeia param (facet.name) → arrayOverlaps na coluna correta", () => {
    // param "region" filtra na coluna regionSlugs (o rename).
    expect(out).toContain(
      "arrayOverlaps(caseFacets.regionSlugs, params[\"region\"]!)",
    );
    expect(out).toContain(
      "arrayOverlaps(caseFacets.industry, params[\"industry\"]!)",
    );
  });

  it("read retorna o shape do read API keyed por facet.name (region, não regionSlugs)", () => {
    // no shape de leitura, a chave é o facet.name "region", vindo de row.regionSlugs.
    expect(out).toContain("region: row.regionSlugs,");
    expect(out).toContain("industry: row.industry,");
  });

  it("upsert consome columnProps e faz onConflictDoUpdate na tabela gerada", () => {
    expect(out).toContain(".insert(caseFacets)");
    expect(out).toContain(
      ".onConflictDoUpdate({ target: caseFacets.entryId, set: values });",
    );
    expect(out).toContain('regionSlugs: facets["regionSlugs"] ?? [],');
  });

  it("listFiltered faz innerJoin + count na tabela gerada", () => {
    expect(out).toContain(
      ".innerJoin(caseFacets, eq(caseFacets.entryId, contentEntries.id))",
    );
    expect(out).toContain("count(*)::int");
  });
});

describe("gen-facets — generalização via fixture ISOLADO blog (AC7/T6)", () => {
  const out = renderFacets(blogConfig);

  it("gera blog_facets com a coluna tags text[] + índice GIN, sem código específico", () => {
    expect(out).toContain('export const blogFacets = pgTable(');
    expect(out).toContain('"blog_facets",');
    expect(out).toContain(
      "text(\"tags\").array().notNull().default(sql`'{}'::text[]`)",
    );
    expect(out).toContain(
      'index("blog_facets_tags_idx").using("gin", blogFacets.tags)',
    );
  });

  it("FacetPort.filter('blog', { tag: [...] }) → arrayOverlaps(blogFacets.tags, …)", () => {
    expect(out).toContain('if (type === "blog") {');
    expect(out).toContain(
      "arrayOverlaps(blogFacets.tags, params[\"tag\"]!)",
    );
  });

  it("blog convive com case (ambas geradas na ordem do config)", () => {
    const caseIdx = out.indexOf('"case_facets"');
    const blogIdx = out.indexOf('"blog_facets"');
    expect(caseIdx).toBeGreaterThan(-1);
    expect(blogIdx).toBeGreaterThan(-1);
    expect(caseIdx).toBeLessThan(blogIdx);
  });
});

describe("gen-facets — config sem facets (fallback)", () => {
  const noFacets: ClientConfig = {
    ...demoCorpConfig,
    collections: demoCorpConfig.collections.map((c) => ({
      ...c,
      facets: undefined,
    })),
  };
  const out = renderFacets(noFacets);

  it("emite FacetPort vazio (sempre null) e nenhuma tabela", () => {
    expect(out).toContain("export const facetPort: FacetPort = {");
    expect(out).not.toContain("pgTable(");
    expect(out).toContain("Nenhuma coleção declara facets");
  });
});
