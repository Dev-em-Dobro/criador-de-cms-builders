// S2.3 — testes dos geradores gen-enums e gen-content-types.
//
// Provam que os geradores produzem, a partir do baseline do Demo Corp, os
// artefatos byte-idênticos ao gold-standard (9 tipos na ordem canônica,
// SINGLETON_PAGES/SEGMENT_TO_TYPE corretos).

import { describe, it, expect } from "vitest";
import { renderEnums } from "./gen-enums.js";
import { renderContentTypes } from "./gen-content-types.js";
import { demoCorpConfig } from "../../../templates/config-examples/demo-corp.config.js";

const NINE_TYPES = [
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

describe("gen-enums", () => {
  const out = renderEnums(demoCorpConfig);

  it("header AUTO-GERADO na primeira linha", () => {
    expect(out.split("\n")[0]).toBe(
      "// AUTO-GERADO por cms-core generate — não editar",
    );
  });

  it("importa pgEnum de drizzle-orm/pg-core", () => {
    expect(out).toContain('import { pgEnum } from "drizzle-orm/pg-core";');
  });

  it("emite os 9 tipos na ordem canônica, dentro de pgEnum('content_type', …)", () => {
    expect(out).toContain('pgEnum("content_type", [');
    for (const t of NINE_TYPES) {
      expect(out).toContain(`  "${t}",`);
    }
    // ordem: cada tipo aparece na posição correta relativa.
    const idxs = NINE_TYPES.map((t) => out.indexOf(`"${t}"`));
    const sorted = [...idxs].sort((a, b) => a - b);
    expect(idxs).toEqual(sorted);
  });

  it("é determinístico (mesmo config → mesmo output)", () => {
    expect(renderEnums(demoCorpConfig)).toBe(out);
  });
});

describe("gen-content-types", () => {
  const out = renderContentTypes(demoCorpConfig);

  it("header AUTO-GERADO na primeira linha", () => {
    expect(out.split("\n")[0]).toBe(
      "// AUTO-GERADO por cms-core generate — não editar",
    );
  });

  it("CONTENT_TYPES as const com os 9 tipos na ordem", () => {
    expect(out).toContain("export const CONTENT_TYPES = [");
    expect(out).toContain("] as const;");
    const idxs = NINE_TYPES.map((t) => out.indexOf(`"${t}"`));
    const sorted = [...idxs].sort((a, b) => a - b);
    expect(idxs).toEqual(sorted);
  });

  it("type ContentType = union literal (não string)", () => {
    expect(out).toContain(
      "export type ContentType = (typeof CONTENT_TYPES)[number];",
    );
  });

  it("SEGMENT_TO_TYPE: 5 segmentos não-singleton na ordem de inserção", () => {
    expect(out).toContain('"cases": "case",');
    expect(out).toContain('"solutions": "solution",');
    expect(out).toContain('"people": "person",');
    expect(out).toContain('"regions": "region",');
    expect(out).toContain('"insights": "insight",');
    // singletons NÃO entram em SEGMENT_TO_TYPE — o bloco não referencia page_*.
    const segBlock = out.slice(
      out.indexOf("SEGMENT_TO_TYPE"),
      out.indexOf("SINGLETON_PAGES"),
    );
    expect(segBlock).not.toContain("page_legal");
    expect(segBlock).not.toContain("page_5h");
  });

  it("SINGLETON_PAGES: 6 rotas (5h/book/awards/privacy/cookies/terms)", () => {
    expect(out).toContain('"5h": { type: "page_5h", slug: "5h" },');
    expect(out).toContain('"book": { type: "page_book", slug: "book" },');
    expect(out).toContain('"awards": { type: "page_awards", slug: "awards" },');
    expect(out).toContain(
      '"privacy": { type: "page_legal", slug: "privacy" },',
    );
    expect(out).toContain(
      '"cookies": { type: "page_legal", slug: "cookies" },',
    );
    expect(out).toContain('"terms": { type: "page_legal", slug: "terms" },');
  });

  it("é determinístico", () => {
    expect(renderContentTypes(demoCorpConfig)).toBe(out);
  });
});
