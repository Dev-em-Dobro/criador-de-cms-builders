import Link from "next/link";
import { SINGLETON_PAGES, defForType } from "@/lib/core-runtime";

/**
 * Páginas singleton derivadas de `SINGLETON_PAGES` (gerado de client.config.ts
 * por gen-content-types). Antes esta lista era hardcoded com as legal pages do
 * CMS-modelo (privacy/cookies/terms): num cliente com outros singletons ela
 * mostrava três links quebrados e escondia as páginas que existem de verdade.
 */
export default function PagesList() {
  const routes = Object.entries(SINGLETON_PAGES);

  // Um mesmo tipo pode responder por várias rotas (page_legal →
  // privacy/cookies/terms). Aí o label do TIPO se repetiria em todos os cards e
  // a chave da rota é o que distingue; com rota única o label do tipo é melhor.
  const routesPerType = new Map<string, number>();
  for (const [, cfg] of routes) {
    routesPerType.set(cfg.type, (routesPerType.get(cfg.type) ?? 0) + 1);
  }

  const pages = routes.map(([key, cfg]) => ({
    key,
    label:
      (routesPerType.get(cfg.type) ?? 0) > 1
        ? key.charAt(0).toUpperCase() + key.slice(1)
        : defForType(cfg.type).label,
  }));

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-ink">Pages</h1>
      <p className="mb-5 text-sm text-muted">
        Singleton pages — one entry each.
      </p>
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {pages.map(({ key, label }) => (
          <li key={key}>
            <Link
              href={`/pages/${key}`}
              className="flex min-h-16 items-center rounded-lg border border-line-strong p-4 transition-colors duration-150 hover:border-brand-dark hover:bg-paper"
            >
              <span className="font-medium text-ink">{label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
