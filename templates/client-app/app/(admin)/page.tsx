import Link from "next/link";
import { NAV } from "@/lib/admin/nav.generated";

// Cards do dashboard = itens de CONTEÚDO da nav GERADA de client.config.ts
// (coleções não-singleton + "Legal pages" quando há singletons). Os itens de
// infraestrutura do core ficam de fora: já vivem na navegação lateral e não são
// conteúdo editorial. Antes esta lista era hardcoded com os tipos do CMS-modelo
// (case/solution/person/…), o que quebrava qualquer cliente com outro schema —
// `REGISTRY[t]` vinha undefined e o render estourava em `def.segment`.
const INFRA_HREFS = new Set([
  "/",
  "/media",
  "/leads",
  "/settings/languages",
  "/users",
]);

export default function Dashboard() {
  const cards = NAV.filter((item) => !INFRA_HREFS.has(item.href));

  return (
    <div>
      <h1 className="text-2xl font-bold text-ink">Dashboard</h1>
      <p className="mt-1 text-sm text-muted">
        Content overview. Everything here is editable without a developer.
      </p>
      <ul className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3">
        {cards.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className="flex h-full flex-col rounded-lg border border-line-strong p-4 transition-colors duration-150 hover:border-brand-dark hover:bg-paper"
            >
              <p className="text-sm font-semibold text-ink">{item.label}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
