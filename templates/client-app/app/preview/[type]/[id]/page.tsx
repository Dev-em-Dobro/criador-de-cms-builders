import { notFound } from "next/navigation";
import { verifyPreviewToken } from "@cms-core/core/auth";
import { resolveTypeParam, defForType } from "@/lib/core-runtime";
import { getEntry } from "@/lib/core-runtime";

/**
 * Draft-aware preview, gated by a signed, short-lived preview token bound to the
 * entry id (D5). The public site never uses this route.
 */
export default async function PreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ type: string; id: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { type: param, id } = await params;
  const { token } = await searchParams;
  const type = resolveTypeParam(param);
  if (!type || !token || !(await verifyPreviewToken(token, id))) notFound();

  const entry = await getEntry(type, id);
  if (!entry) notFound();

  const item = defForType(type).toListItem(entry.data);

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <p className="mb-4 inline-block rounded bg-paper px-3 py-1 text-xs uppercase tracking-widest text-muted">
        Preview · {entry.status}
      </p>
      <h1 className="text-3xl font-bold text-ink">{item.title}</h1>
      {item.summary && <p className="mt-2 text-muted">{item.summary}</p>}
      <pre className="mt-6 overflow-x-auto rounded-lg border border-line-strong bg-paper p-4 text-xs">
        {JSON.stringify(entry.data, null, 2)}
      </pre>
    </main>
  );
}
