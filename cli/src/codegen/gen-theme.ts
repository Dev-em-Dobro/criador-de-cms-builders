// @cms-core/cli — gen-theme (S2.6, R4).
//
// Emite `app/theme.generated.css` com o bloco `@theme` das 6 cores de MARCA +
// `--font-sans` (de `branding.fontFamily`). Conforme ADR-003 §3.7 (decomposição
// alvo = gerado + fixo): o RESTO do `@theme` gold (tokens semânticos
// danger/success/draft/line, `--spacing-gutter`) e os blocos html/body/
// :focus-visible/reduced-motion são TEMPLATE ESTÁTICO no `globals.css` do
// cliente — NÃO gerados (cor de "danger" não é branding de cliente).
//
// O `globals.css` faz `@import "./theme.generated.css";` e mantém o fixo.
//
// Determinismo (D1/D2): cores emitidas em ordem fixa (brand, brand-dark,
// brand-darker, ink, muted, paper). `--font-sans` deriva de `fontFamily`.

import { resolve } from "node:path";
import type { ClientConfig } from "@cms-core/core/config";
import { writeGenerated } from "./shared.js";

/** Deriva o nome da CSS var da fonte (ex.: "Poppins" → "--font-poppins"). O
 * Next.js `next/font` expõe a fonte por essa var (config `variable`). */
export function fontVarName(fontFamily: string): string {
  return `--font-${fontFamily.toLowerCase().replace(/\s+/g, "-")}`;
}

/** Renderiza o conteúdo de `theme.generated.css` (função pura — testável). */
export function renderTheme(config: ClientConfig): string {
  const c = config.branding.colors;
  const font = config.branding.fontFamily;

  const lines: string[] = [];
  // --font-sans primeiro (espelha a ordem do globals.css gold).
  if (font) {
    lines.push(
      `  --font-sans: var(${fontVarName(font)}), system-ui, sans-serif;`,
    );
    lines.push("");
  }
  // 6 cores de marca em ordem fixa. Só emite as presentes no config (brand e
  // brandDark são required; as demais são opcionais no BrandingConfig).
  lines.push(`  --color-brand: ${c.brand};`);
  lines.push(`  --color-brand-dark: ${c.brandDark};`);
  if (c.brandDarker) lines.push(`  --color-brand-darker: ${c.brandDarker};`);
  if (c.ink) lines.push(`  --color-ink: ${c.ink};`);
  if (c.muted) lines.push(`  --color-muted: ${c.muted};`);
  if (c.paper) lines.push(`  --color-paper: ${c.paper};`);

  return `/* AUTO-GERADO por cms-core generate — não editar */
/* Bloco @theme das cores de marca + fonte, derivado de client.config.ts
   (branding.colors + branding.fontFamily). Importado por app/globals.css. Os
   tokens semânticos (danger/success/draft/line) e o spacing são fixos do core
   e permanecem no globals.css (ADR-003 §3.7). */
@theme {
${lines.join("\n")}
}
`;
}

/** Gera `app/theme.generated.css` no workspace-alvo. */
export function genTheme(config: ClientConfig, workspaceDir: string): string {
  const outPath = resolve(workspaceDir, "app/theme.generated.css");
  writeGenerated(outPath, renderTheme(config));
  return outPath;
}
