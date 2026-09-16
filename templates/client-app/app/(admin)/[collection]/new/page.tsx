import { notFound } from "next/navigation";
import { SEGMENT_TO_TYPE, defForType } from "@/lib/core-runtime";
import { FIELDS, emptyData } from "@/lib/core-runtime";
import { activeLocales, getDefaultLocale } from "@/lib/core-runtime";
import ContentEditor from "@/components/ContentEditorWithHistory";

export default async function NewEntry({
  params,
}: {
  params: Promise<{ collection: string }>;
}) {
  const { collection } = await params;
  const type = SEGMENT_TO_TYPE[collection];
  if (!type) notFound();
  const [available, defaultLocale] = await Promise.all([
    activeLocales(),
    getDefaultLocale(),
  ]);

  return (
    <ContentEditor
      apiType={collection}
      collection={collection}
      mode="collection"
      fields={FIELDS[type]}
      initial={{ data: emptyData(type) }}
      label={`New ${defForType(type).label}`}
      availableLocales={available}
      defaultLocale={defaultLocale}
    />
  );
}
