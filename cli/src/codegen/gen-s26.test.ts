// S2.6 — testes dos geradores gen-zod, gen-ui-fields, gen-theme, gen-nav.
//
// gen-zod/gen-ui-fields usam runtime-call (byte-identidade automática via
// TEST-001 do core); os testes verificam a FORMA do arquivo gerado (import do
// config, chamada do builder, header). gen-theme/gen-nav são derivações diretas
// do config — testados contra os valores do baseline Demo Corp.

import { describe, it, expect } from "vitest";
import { renderZod } from "./gen-zod.js";
import { renderUiFields } from "./gen-ui-fields.js";
import { renderTheme, fontVarName } from "./gen-theme.js";
import { renderNav } from "./gen-nav.js";
import { demoCorpConfig } from "../../../templates/config-examples/demo-corp.config.js";

describe("gen-zod", () => {
  const out = renderZod("demoCorpConfig");

  it("header AUTO-GERADO na primeira linha", () => {
    expect(out.split("\n")[0]).toBe(
      "// AUTO-GERADO por cms-core generate — não editar",
    );
  });

  it("chama buildZodSchemas(config) em runtime (D3 — não z.object textual)", () => {
    expect(out).toContain(
      'import { buildZodSchemas } from "@cms-core/core/config";',
    );
    expect(out).toContain(
      "export const schemas: Record<string, ZodTypeAny> = buildZodSchemas(clientConfig);",
    );
    // NÃO reconstrói schemas textualmente (o z.object só aparece no comentário
    // explicativo, nunca como construção de código `z.object({`).
    expect(out).not.toContain("z.object({");
  });

  it("importa o config pelo nome do export descoberto", () => {
    expect(out).toContain(
      'import { demoCorpConfig as clientConfig } from "@/client.config";',
    );
  });

  it("import default quando o config é export default", () => {
    expect(renderZod("default")).toContain(
      'import clientConfig from "@/client.config";',
    );
  });
});

describe("gen-ui-fields", () => {
  const out = renderUiFields("demoCorpConfig");

  it("header AUTO-GERADO na primeira linha", () => {
    expect(out.split("\n")[0]).toBe(
      "// AUTO-GERADO por cms-core generate — não editar",
    );
  });

  it("runtime-call a buildFields/buildEmptyData (filtram uiHidden)", () => {
    expect(out).toContain(
      'import { buildFields, buildEmptyData, type FieldSpec } from "@cms-core/core/config";',
    );
    expect(out).toContain(
      "export const FIELDS: Record<string, FieldSpec[]> = buildFields(clientConfig);",
    );
    expect(out).toContain("return buildEmptyData(clientConfig, type);");
  });
});

describe("gen-theme", () => {
  const out = renderTheme(demoCorpConfig);

  it("fontVarName deriva a CSS var da fonte", () => {
    expect(fontVarName("Poppins")).toBe("--font-poppins");
    expect(fontVarName("Open Sans")).toBe("--font-open-sans");
  });

  it("header AUTO-GERADO + bloco @theme", () => {
    expect(out.split("\n")[0]).toBe(
      "/* AUTO-GERADO por cms-core generate — não editar */",
    );
    expect(out).toContain("@theme {");
  });

  it("emite as 6 cores de marca do baseline (byte-idênticas ao globals.css)", () => {
    expect(out).toContain("--color-brand: #d84339;");
    expect(out).toContain("--color-brand-dark: #b5342b;");
    expect(out).toContain("--color-brand-darker: #94291f;");
    expect(out).toContain("--color-ink: #373234;");
    expect(out).toContain("--color-muted: #6b6b6b;");
    expect(out).toContain("--color-paper: #f3f3f3;");
  });

  it("emite --font-sans de branding.fontFamily (Poppins)", () => {
    expect(out).toContain(
      "--font-sans: var(--font-poppins), system-ui, sans-serif;",
    );
  });

  it("NÃO emite tokens semânticos fixos (danger/success/line/spacing)", () => {
    expect(out).not.toContain("--color-danger");
    expect(out).not.toContain("--color-line");
    expect(out).not.toContain("--spacing-gutter");
  });

  it("é determinístico", () => {
    expect(renderTheme(demoCorpConfig)).toBe(out);
  });
});

describe("gen-nav", () => {
  const out = renderNav(demoCorpConfig);

  it("header AUTO-GERADO na primeira linha", () => {
    expect(out.split("\n")[0]).toBe(
      "// AUTO-GERADO por cms-core generate — não editar",
    );
  });

  it("importa NavItem do core", () => {
    expect(out).toContain('import type { NavItem } from "@cms-core/core/ui";');
  });

  it("Dashboard fixo antes das coleções", () => {
    expect(out).toContain('{ href: "/", label: "Dashboard" },');
  });

  it("itens de coleção não-singleton na ordem do config (href por segment)", () => {
    for (const [href, label] of [
      ["/cases", "Case study"],
      ["/solutions", "Solution"],
      ["/people", "Person"],
      ["/regions", "Region"],
      ["/insights", "Insight"],
    ]) {
      expect(out).toContain(`{ href: "${href}", label: "${label}" },`);
    }
    // ordem: cases antes de insights.
    expect(out.indexOf('"/cases"')).toBeLessThan(out.indexOf('"/insights"'));
  });

  it("singletons colapsam num só /pages fixo", () => {
    expect(out).toContain('{ href: "/pages", label: "Legal pages" },');
    // não gera itens por singleton (page_5h, page_book, etc.).
    expect(out).not.toContain("page_5h");
    expect(out).not.toContain("page_legal");
  });

  it("itens fixos do core (media/leads/languages/users) com adminOnly nos 2 últimos", () => {
    expect(out).toContain('{ href: "/media", label: "Media" },');
    expect(out).toContain('{ href: "/leads", label: "Contacts" },');
    expect(out).toContain(
      '{ href: "/settings/languages", label: "Languages", adminOnly: true },',
    );
    expect(out).toContain(
      '{ href: "/users", label: "Users & audit", adminOnly: true },',
    );
  });

  it("é determinístico", () => {
    expect(renderNav(demoCorpConfig)).toBe(out);
  });
});
