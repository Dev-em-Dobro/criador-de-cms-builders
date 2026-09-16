"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/ui/useConfirm";
import { buttonQuiet, buttonDanger } from "@cms-core/core/ui";

/**
 * Per-row Edit + Delete actions for the content lists. Delete is a soft delete
 * of the whole logical entry (every language variant) via the existing
 * `DELETE /api/admin/{collection}/{id}` endpoint.
 *
 * By default it calls `router.refresh()` so a server-rendered list drops the
 * row. Pass `onDeleted` when the parent keeps its own client-side list (the
 * people reorder list) and wants to remove the item from local state instead.
 */
export default function RowActions({
  collection,
  id,
  title,
  onDeleted,
}: {
  collection: string;
  id: string;
  title: string;
  onDeleted?: () => void;
}) {
  const router = useRouter();
  const [confirm, confirmDialog] = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function remove() {
    const ok = await confirm({
      title: `Delete ${title}?`,
      description:
        "This removes the entry and all of its language versions from the site. You can't undo this from here.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;

    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/${collection}/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setError(b.error ?? "Delete failed.");
        return;
      }
      if (onDeleted) onDeleted();
      else router.refresh();
    } catch {
      setError("Delete failed — could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-1">
      <Link href={`/${collection}/${id}`} className={buttonQuiet}>
        Edit
        <span className="sr-only"> {title}</span>
      </Link>
      <button
        type="button"
        onClick={remove}
        disabled={busy}
        aria-busy={busy}
        className={buttonDanger}
      >
        {busy ? "Deleting…" : "Delete"}
        <span className="sr-only"> {title}</span>
      </button>
      {error && (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
      {confirmDialog}
    </span>
  );
}
