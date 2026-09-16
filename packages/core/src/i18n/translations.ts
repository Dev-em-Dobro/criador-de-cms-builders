// @cms-core/core/i18n — helpers puros de apresentação de grupos de tradução (S1.4).
//
// Movido de clients/demo-corp/lib/content/translations.ts SEM alteração
// (puro — sem acesso a DB ou DOM). Um "translation group" é o conjunto de
// variantes de idioma de uma peça lógica (mesmo translationGroupId).

/** A row from the admin list, pre-shaped for grouping. */
export interface ListVariant {
  id: string;
  locale: string;
  status: string;
  title: string;
  updatedAt: string; // ISO string
  translationGroupId: string;
}

export interface GroupedListItem {
  translationGroupId: string;
  /** Title/id/updatedAt come from the default-locale variant when present. */
  title: string;
  primaryId: string;
  updatedAt: string;
  variants: { id: string; locale: string; status: string }[];
}

/**
 * Collapse per-locale rows into one item per translation group, preserving the
 * order in which groups first appear. The "primary" variant (default locale, or
 * the first if the default is absent) supplies the title, link target, and date.
 */
export function groupByTranslationGroup(
  items: ListVariant[],
  defaultLocale: string,
): GroupedListItem[] {
  const order: string[] = [];
  const groups = new Map<string, ListVariant[]>();
  for (const it of items) {
    if (!groups.has(it.translationGroupId)) {
      groups.set(it.translationGroupId, []);
      order.push(it.translationGroupId);
    }
    groups.get(it.translationGroupId)!.push(it);
  }

  return order.map((gid) => {
    const group = groups.get(gid)!;
    const primary = group.find((g) => g.locale === defaultLocale) ?? group[0];
    const variants = [...group]
      .sort((a, b) => a.locale.localeCompare(b.locale))
      .map((g) => ({ id: g.id, locale: g.locale, status: g.status }));
    return {
      translationGroupId: gid,
      title: primary.title,
      primaryId: primary.id,
      updatedAt: primary.updatedAt,
      variants,
    };
  });
}

/** Active languages a piece does NOT yet have, given the codes it already has. */
export function missingLocales<T extends { code: string }>(
  existing: string[],
  active: T[],
): T[] {
  return active.filter((l) => !existing.includes(l.code));
}
