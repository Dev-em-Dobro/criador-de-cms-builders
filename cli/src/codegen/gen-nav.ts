// @cms-core/cli — gen-nav (S2.6, R4).
//
// Emite `lib/admin/nav.generated.ts` com o array `NAV` do admin: itens de
// COLEÇÃO não-singleton (derivados do config) + itens FIXOS do core (Dashboard,
// Legal pages, Media, Contacts, Languages, Users). Conforme ADR-003 §3.8:
//   • itens de coleção usam `collection.label` (a divergência cosmética de
//     pluralização — "Case study" vs "Case studies" — é ACEITA; e2e navega por
//     href, não por label; NÃO estender contrato com `navLabel`).
//   • os 4 singletons colapsam num só item fixo `/pages "Legal pages"`.
//   • Dashboard/Media/Contacts/Languages/Users são fixos do core (iguais em todo
//     CMS) — hardcoded no gerador, não no config.
//
// Determinismo (D1/D2): itens de coleção na ORDEM do array `collections`; fixos
// em ordem constante (Dashboard antes; pages/media/leads/languages/users depois).

import { resolve } from "node:path";
import type { ClientConfig } from "@cms-core/core/config";
import { GENERATED_HEADER, tsString, writeGenerated } from "./shared.js";

interface NavLine {
  href: string;
  label: string;
  adminOnly?: boolean;
}

/** Renderiza o conteúdo de `nav.generated.ts` (função pura — testável). */
export function renderNav(config: ClientConfig): string {
  // Itens de coleção (não-singleton, na ordem do config). href = "/" + segment.
  const collectionItems: NavLine[] = config.collections
    .filter((c) => !c.singleton && c.segment)
    .map((c) => ({ href: `/${c.segment}`, label: c.label }));

  // Item fixo `/pages` só aparece se há ao menos um singleton no config.
  const hasSingletons = config.collections.some((c) => c.singleton);

  // Fixos do core (iguais em todo CMS). Dashboard vem antes das coleções; o
  // restante (pages/media/leads/languages/users) depois.
  const items: NavLine[] = [
    { href: "/", label: "Dashboard" },
    ...collectionItems,
    ...(hasSingletons ? [{ href: "/pages", label: "Legal pages" }] : []),
    { href: "/media", label: "Media" },
    { href: "/leads", label: "Contacts" },
    { href: "/settings/languages", label: "Languages", adminOnly: true },
    { href: "/users", label: "Users & audit", adminOnly: true },
  ];

  const lines = items
    .map((n) => {
      const parts = [
        `href: ${tsString(n.href)}`,
        `label: ${tsString(n.label)}`,
      ];
      if (n.adminOnly) parts.push("adminOnly: true");
      return `  { ${parts.join(", ")} },`;
    })
    .join("\n");

  return `${GENERATED_HEADER}
// Itens de nav do admin derivados de client.config.ts (coleções não-singleton) +
// itens fixos do core (Dashboard, Legal pages, Media, Contacts, Languages, Users).

import type { NavItem } from "@cms-core/core/ui";

export const NAV: (NavItem & { adminOnly?: boolean })[] = [
${lines}
];
`;
}

/** Gera `lib/admin/nav.generated.ts` no workspace-alvo. */
export function genNav(config: ClientConfig, workspaceDir: string): string {
  const outPath = resolve(workspaceDir, "lib/admin/nav.generated.ts");
  writeGenerated(outPath, renderNav(config));
  return outPath;
}
