"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * One-click "＋" to add a missing language to a piece, straight from the content
 * list. Creates the translation (pre-filled from source via /translate) and
 * opens it. Mirrors the create action in TranslationBar.
 */
export default function AddTranslationButton({
  apiType,
  id,
  code,
  label,
  collection,
}: {
  apiType: string;
  id: string;
  code: string;
  label: string;
  collection: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/${apiType}/${id}/translate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ locale: code }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.id) {
        router.push(`/${collection}/${body.id}`);
        return;
      }
      router.refresh(); // already exists / failed — reflect reality
    } catch {
      // leave it re-enabled to retry
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={create}
      disabled={busy}
      title={`Add ${label}`}
      className="inline-flex items-center gap-1 rounded-full border border-dashed border-line-strong px-2 py-0.5 text-xs text-muted transition-colors duration-150 hover:border-brand-dark hover:text-ink disabled:opacity-50"
    >
      <span aria-hidden="true">+</span>
      <span className="uppercase">{code}</span>
      <span className="sr-only"> add {label} translation</span>
    </button>
  );
}
