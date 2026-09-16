import { notFound } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { contentEntries } from "@/db/schema";
import { SINGLETON_PAGES, defForType } from "@/lib/core-runtime";
import { FIELDS, emptyData } from "@/lib/core-runtime";
import {
  activeLocales,
  getDefaultLocale,
  resolveLocale,
} from "@/lib/core-runtime";
import { listTranslations } from "@/lib/core-runtime";
import ContentEditor from "@/components/ContentEditorWithHistory";
import TranslationBar from "@/components/TranslationBar";

export default async function SingletonEditor({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ locale?: string }>;
}) {
  const { key } = await params;
  const { locale: requested } = await searchParams;
  const cfg = SINGLETON_PAGES[key];
  if (!cfg) notFound();

  const [locale, defaultLocale] = await Promise.all([
    resolveLocale(requested),
    getDefaultLocale(),
  ]);

  // Load the requested language variant; fall back to the default language.
  async function loadFor(loc: string) {
    const [row] = await db
      .select()
      .from(contentEntries)
      .where(
        and(
          // cfg.type deriva do config (string); a coluna é pgEnum. Cast na
          // fronteira do Drizzle (mesmo padrão da ADR-001 §6.5 / core-runtime):
          // o valor SEMPRE é um content type válido (vem do SINGLETON_PAGES).
          eq(
            contentEntries.type,
            cfg.type as (typeof contentEntries.$inferSelect)["type"],
          ),
          eq(contentEntries.slug, cfg.slug),
          eq(contentEntries.locale, loc),
          isNull(contentEntries.deletedAt),
        ),
      );
    return row;
  }

  const entry =
    (await loadFor(locale)) ??
    (locale !== defaultLocale ? await loadFor(defaultLocale) : undefined);

  const [translations, active] = entry
    ? await Promise.all([listTranslations(entry.translationGroupId), activeLocales()])
    : [[], []];

  const initial = entry
    ? {
        id: entry.id,
        data: entry.data,
        currentVersionId: entry.currentVersionId,
        status: entry.status,
        hasUnpublishedChanges: entry.hasUnpublishedChanges,
      }
    : { data: emptyData(cfg.type) };

  return (
    <>
      {entry && (
        <TranslationBar
          apiType={cfg.type}
          id={entry.id}
          currentLocale={entry.locale}
          existing={translations}
          active={active}
          kind="singleton"
          pageKey={key}
          defaultLocale={defaultLocale}
        />
      )}
      <ContentEditor
        apiType={cfg.type}
        collection="pages"
        mode="singleton"
        fixedSlug={cfg.slug}
        fields={FIELDS[cfg.type]}
        initial={initial}
        label={`${defForType(cfg.type).label} (${key})`}
        defaultLocale={defaultLocale}
      />
    </>
  );
}
