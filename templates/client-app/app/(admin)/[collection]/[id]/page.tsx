import { notFound } from "next/navigation";
import { SEGMENT_TO_TYPE, defForType } from "@/lib/core-runtime";
import { FIELDS } from "@/lib/core-runtime";
import { getEntry, listTranslations } from "@/lib/core-runtime";
import { activeLocales, getDefaultLocale } from "@/lib/core-runtime";
import ContentEditor from "@/components/ContentEditorWithHistory";
import TranslationBar from "@/components/TranslationBar";

export default async function EditEntry({
  params,
}: {
  params: Promise<{ collection: string; id: string }>;
}) {
  const { collection, id } = await params;
  const type = SEGMENT_TO_TYPE[collection];
  if (!type) notFound();
  const entry = await getEntry(type, id);
  if (!entry) notFound();
  const [translations, active, defaultLocale] = await Promise.all([
    listTranslations(entry.translationGroupId),
    activeLocales(),
    getDefaultLocale(),
  ]);

  return (
    <>
      <TranslationBar
        apiType={collection}
        id={entry.id}
        currentLocale={entry.locale}
        existing={translations}
        active={active}
        kind="collection"
        collection={collection}
        defaultLocale={defaultLocale}
      />
      <ContentEditor
        apiType={collection}
        collection={collection}
        mode="collection"
        fields={FIELDS[type]}
        initial={{
          id: entry.id,
          data: entry.data,
          currentVersionId: entry.currentVersionId,
          status: entry.status,
          hasUnpublishedChanges: entry.hasUnpublishedChanges,
        }}
        label={defForType(type).label}
        canPreview={type !== "person" && type !== "region"}
      />
    </>
  );
}
