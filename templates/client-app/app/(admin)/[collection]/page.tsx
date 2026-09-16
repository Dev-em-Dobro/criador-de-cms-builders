import Link from "next/link";
import { notFound } from "next/navigation";
import { SEGMENT_TO_TYPE, defForType } from "@/lib/core-runtime";
import { listEntries } from "@/lib/core-runtime";
import { activeLocales, getDefaultLocale } from "@/lib/core-runtime";
import { groupByTranslationGroup } from "@cms-core/core/i18n";
import { StatusBadge, buttonPrimary } from "@cms-core/core/ui";
import AddTranslationButton from "@/components/AddTranslationButton";
import RowActions from "@/components/admin/RowActions";
import PeopleReorderList from "@/components/admin/PeopleReorderList";

export default async function CollectionList({
  params,
}: {
  params: Promise<{ collection: string }>;
}) {
  const { collection } = await params;
  const type = SEGMENT_TO_TYPE[collection];
  if (!type) notFound();
  const def = defForType(type);
  // Orderable types carry an editorial order (drag-and-drop); everything else is
  // recency. Generaliza o hardcoded `type === "person"` via `def.orderable`
  // (S2.6 AC5) — a flag vem do config (`orderable: true` só em `person`).
  const isPeople = def.orderable === true;
  const [entries, active, defaultLocale] = await Promise.all([
    listEntries(type, {
      limit: 100,
      orderBy: isPeople ? "sortOrder" : "updatedAt",
    }).catch(() => []),
    activeLocales(),
    getDefaultLocale(),
  ]);
  // CMS de um idioma só: chips de idioma não têm função (nada para trocar, nada
  // para traduzir). A coluna vira o selo de situação, que é o dado útil ali.
  const monolingue = active.length <= 1;
  // Collapse locale variants of the same piece into one row (FR-010).
  const groups = groupByTranslationGroup(
    entries.map((e) => ({
      id: e.id,
      locale: e.locale,
      status: e.status,
      title: def.toListItem(e.data).title,
      updatedAt: new Date(e.updatedAt).toISOString(),
      translationGroupId: e.translationGroupId,
    })),
    defaultLocale,
  );

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-ink">{def.label}</h1>
        <Link href={`/${collection}/new`} className={buttonPrimary}>
          New
          <span className="sr-only"> {def.label}</span>
        </Link>
      </div>

      {entries.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line-strong p-10 text-center">
          <p className="text-sm font-medium text-ink">Nothing here yet</p>
          <p className="mt-1 text-sm text-muted">
            Create your first entry to see it listed here.
          </p>
          <Link
            href={`/${collection}/new`}
            className={`${buttonPrimary} mt-4`}
          >
            New {def.label}
          </Link>
        </div>
      ) : isPeople ? (
        <PeopleReorderList
          rows={groups}
          active={active}
          collection={collection}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line-strong">
          <table className="w-full min-w-[36rem] text-sm">
            <caption className="sr-only">
              {def.label} entries with their languages and last update
            </caption>
            <thead className="bg-paper text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th scope="col" className="px-4 py-2 font-semibold">Title</th>
                <th scope="col" className="px-4 py-2 font-semibold">
                  {monolingue ? "Status" : "Languages"}
                </th>
                <th scope="col" className="px-4 py-2 font-semibold">Updated</th>
                <th scope="col" className="px-4 py-2 text-right font-semibold">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr
                  key={g.translationGroupId}
                  className="border-t border-line transition-colors duration-150 hover:bg-paper"
                >
                  <th scope="row" className="px-4 py-2 text-left font-normal">
                    <Link
                      href={`/${collection}/${g.primaryId}`}
                      className="font-medium text-ink underline decoration-line-strong underline-offset-2 transition-colors duration-150 hover:decoration-brand-dark"
                    >
                      {g.title}
                    </Link>
                  </th>
                  <td className="px-4 py-2">
                    {monolingue ? (
                      <StatusBadge status={g.variants[0]?.status ?? "draft"} />
                    ) : (
                    <span className="flex flex-wrap items-center gap-1.5">
                      {active.map((l) => {
                        const v = g.variants.find((x) => x.locale === l.code);
                        return v ? (
                          <Link
                            key={l.code}
                            href={`/${collection}/${v.id}`}
                            title={`${l.label} — ${v.status}`}
                            className="inline-flex items-center gap-1 rounded-full border border-line-strong px-2 py-0.5 text-xs text-ink transition-colors duration-150 hover:border-brand-dark"
                          >
                            <span className="uppercase">{l.code}</span>
                            <StatusBadge status={v.status} />
                          </Link>
                        ) : (
                          <AddTranslationButton
                            key={l.code}
                            apiType={collection}
                            id={g.primaryId}
                            code={l.code}
                            label={l.label}
                            collection={collection}
                          />
                        );
                      })}
                    </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-muted">
                    <time dateTime={g.updatedAt}>
                      {new Date(g.updatedAt).toLocaleDateString()}
                    </time>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <RowActions
                      collection={collection}
                      id={g.primaryId}
                      title={g.title}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
