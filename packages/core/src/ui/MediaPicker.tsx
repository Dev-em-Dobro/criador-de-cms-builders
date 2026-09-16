"use client";

import { useCallback, useEffect, useState } from "react";
import Modal from "./Modal.js";
import { Skeleton, StatusMessage } from "./Feedback.js";
import LoadingOverlay from "./LoadingOverlay.js";
import { buttonPrimary, buttonQuiet, buttonSecondary } from "./styles.js";
// Import the client-safe constant from the media `validate` leaf (not the
// `@cms-core/core/media` barrel). The barrel statically re-exports server-only
// modules (`image`/`image-facts` → `sharp` → `node:child_process`); pulling it
// into this client component makes Turbopack try to bundle `sharp` for the
// browser, which fails. `validate.ts` is pure (constants only), so the leaf
// import keeps this client component free of any server-only dependency.
// (ADR-004 / S2.8 — surfaced once the core `next build` reached chunking.)
import { ACCEPT_ATTR } from "../media/validate.js";
import { useCoreStrings } from "./strings.js";

interface MediaItem {
  id: string;
  deliveryUrl: string;
  filename: string;
  mimeType: string;
}

export default function MediaPicker({
  value,
  onChange,
  labelledBy,
  describedBy,
  uploadField,
  disabled,
}: {
  value?: string;
  onChange: (id: string | undefined) => void;
  labelledBy?: string;
  describedBy?: string;
  /** Upload policy key sent as `field` (e.g. "logo") for stricter validation. */
  uploadField?: string;
  disabled?: boolean;
}) {
  const t = useCoreStrings();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    fetch("/api/media")
      .then((r) => r.json())
      .then((b) => setItems(b.items ?? []))
      .catch(() => setError(t.mediaLoadFailed))
      .finally(() => {
        setLoading(false);
        setLoaded(true);
      });
  }, []);

  // Load when the dialog opens, and once up-front if a value needs resolving
  // into a thumbnail (there is no GET /api/media/:id endpoint).
  useEffect(() => {
    if ((open || value) && !loaded && !loading) load();
  }, [open, value, loaded, loading, load]);

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      if (uploadField) form.append("field", uploadField);
      const res = await fetch("/api/media", { method: "POST", body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.fields?.file ?? body.error ?? t.uploadFailed);
        return;
      }
      setItems((prev) => [
        {
          id: body.id,
          deliveryUrl: body.deliveryUrl,
          filename: file.name,
          mimeType: body.mimeType,
        },
        ...prev,
      ]);
      onChange(body.id);
      setOpen(false);
    } catch {
      setError(t.uploadFailedOffline);
    } finally {
      setBusy(false);
      e.target.value = ""; // allow re-selecting the same file after an error
    }
  }

  const selected = items.find((m) => m.id === value);

  return (
    <div>
      <div
        role="group"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        className="flex flex-wrap items-center gap-3"
      >
        {value ? (
          <span className="flex items-center gap-2 rounded border border-line-strong p-1 pr-3">
            {selected?.mimeType.startsWith("image/") ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={selected.deliveryUrl}
                alt=""
                width={40}
                height={40}
                loading="lazy"
                className="h-10 w-10 rounded object-cover"
              />
            ) : (
              <span className="grid h-10 w-10 place-items-center rounded bg-paper text-xs text-muted">
                file
              </span>
            )}
            <span className="max-w-48 truncate text-sm text-ink">
              {selected?.filename ?? t.selectedMedia}
            </span>
          </span>
        ) : (
          <span className="text-sm text-muted">{t.noMediaSelected}</span>
        )}
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={disabled}
          className={buttonSecondary}
        >
          {value ? t.change : t.chooseMedia}
        </button>
        {value && (
          <button
            type="button"
            onClick={() => onChange(undefined)}
            disabled={disabled}
            className={buttonQuiet}
          >
            Clear
          </button>
        )}
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t.mediaLibrary}
        description={t.mediaLibraryHint}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <label className={`${buttonPrimary} cursor-pointer`}>
            {busy ? t.uploading : t.upload}
            <input
              type="file"
              accept={ACCEPT_ATTR}
              className="sr-only"
              onChange={upload}
              disabled={busy}
            />
          </label>
          {busy && (
            <span role="status" aria-live="polite" className="text-sm text-muted">
              Uploading…
            </span>
          )}
        </div>

        {error && (
          <StatusMessage tone="error" className="mb-3">
            {error}
          </StatusMessage>
        )}

        {loading ? (
          <Skeleton rows={4} />
        ) : items.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">
            {t.noMediaYet}
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {items.map((m) => {
              const isSelected = m.id === value;
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => {
                      onChange(m.id);
                      setOpen(false);
                    }}
                    className={`w-full overflow-hidden rounded border transition-colors duration-150 ${
                      isSelected
                        ? "border-brand-dark ring-2 ring-brand-dark"
                        : "border-line-strong hover:border-brand-dark"
                    }`}
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
                    <span className="block truncate px-2 py-1.5 text-left text-xs text-ink">
                      {m.filename}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Modal>
      <LoadingOverlay show={busy} message={t.uploading} />
    </div>
  );
}
