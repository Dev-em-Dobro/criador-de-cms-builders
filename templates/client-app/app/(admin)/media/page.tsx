"use client";

import { useEffect, useState } from "react";
import {
  StatusMessage,
  Skeleton,
  LoadingOverlay,
  buttonPrimary,
  buttonDanger,
} from "@cms-core/core/ui";
import { useConfirm } from "@/components/ui/useConfirm";
import { ACCEPT_ATTR } from "@cms-core/core/media/validate";

interface MediaItem {
  id: string;
  deliveryUrl: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

function formatSize(bytes: number) {
  if (!bytes) return "";
  const kb = bytes / 1024;
  return kb < 1024 ? `${Math.round(kb)} KB` : `${(kb / 1024).toFixed(1)} MB`;
}

export default function MediaLibrary() {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirm, confirmDialog] = useConfirm();

  function load() {
    setLoading(true);
    fetch("/api/media")
      .then((r) => r.json())
      .then((b) => setItems(b.items ?? []))
      .catch(() => setError("Could not load the media library."))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/media", { method: "POST", body: form });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setError(b.fields?.file ?? b.error ?? "Upload failed.");
        return;
      }
      setNotice(`${file.name} uploaded.`);
      load();
    } catch {
      setError("Upload failed — could not reach the server.");
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }

  async function remove(item: MediaItem) {
    const ok = await confirm({
      title: `Delete ${item.filename}?`,
      description:
        "This permanently removes the file from the CDN. Any content still referencing it will show a broken image. This cannot be undone.",
      confirmLabel: "Delete file",
      destructive: true,
    });
    if (!ok) return;

    setError("");
    setNotice("");
    setDeletingId(item.id);
    try {
      const res = await fetch(`/api/media/${item.id}`, { method: "DELETE" });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setError(b.error ?? "Delete failed.");
        return;
      }
      setNotice(`${item.filename} deleted.`);
      load();
    } catch {
      setError("Delete failed — could not reach the server.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-ink">Media</h1>
        <label className={`${buttonPrimary} cursor-pointer`}>
          {busy ? "Uploading…" : "Upload"}
          <input
            type="file"
            accept={ACCEPT_ATTR}
            className="sr-only"
            onChange={upload}
            disabled={busy}
          />
        </label>
      </div>

      {error && (
        <StatusMessage tone="error" className="mb-4">
          {error}
        </StatusMessage>
      )}
      {notice && (
        <StatusMessage tone="success" className="mb-4">
          {notice}
        </StatusMessage>
      )}

      {loading ? (
        <Skeleton rows={4} />
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line-strong p-10 text-center">
          <p className="text-sm font-medium text-ink">No media yet</p>
          <p className="mt-1 text-sm text-muted">
            Upload an image to use it as a cover or inline asset.
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {items.map((m) => (
            <li
              key={m.id}
              aria-busy={deletingId === m.id}
              className={`flex flex-col overflow-hidden rounded border border-line-strong transition-opacity duration-150 ${
                deletingId === m.id ? "pointer-events-none opacity-50" : ""
              }`}
            >
              <a
                href={m.deliveryUrl}
                target="_blank"
                rel="noreferrer"
                title={`Open ${m.filename}`}
                className="block transition-opacity duration-150 hover:opacity-90"
              >
                {m.mimeType.startsWith("image/") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={m.deliveryUrl}
                    alt=""
                    loading="lazy"
                    className="h-24 w-full object-cover"
                  />
                ) : (
                  <span className="grid h-24 w-full place-items-center bg-paper text-xs text-muted">
                    file
                  </span>
                )}
              </a>
              <div className="flex flex-1 flex-col gap-1 p-2">
                <a
                  href={m.deliveryUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate text-xs font-medium text-ink hover:text-brand-dark hover:underline"
                  title={`Open ${m.filename}`}
                >
                  {m.filename}
                </a>
                <span className="text-xs text-muted">{formatSize(m.sizeBytes)}</span>
                <button
                  onClick={() => remove(m)}
                  disabled={deletingId === m.id}
                  aria-busy={deletingId === m.id}
                  className={`${buttonDanger} mt-auto self-start disabled:opacity-60`}
                >
                  {deletingId === m.id ? "Deleting…" : "Delete"}
                  <span className="sr-only"> {m.filename}</span>
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {confirmDialog}
      <LoadingOverlay
        show={busy || deletingId !== null}
        message={busy ? "Uploading…" : "Deleting…"}
      />
    </div>
  );
}
