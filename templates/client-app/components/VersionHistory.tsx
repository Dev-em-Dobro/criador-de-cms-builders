"use client";

import { useCallback, useEffect, useState } from "react";
import { Modal, Skeleton, StatusMessage, buttonSecondary } from "@cms-core/core/ui";

interface Version {
  id: string;
  statusAtSave: string;
  createdAt: string;
  authorEmail: string | null;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/**
 * Lists an entry's saved versions and lets the editor restore one. The restore
 * itself (including saving any unsaved on-screen work first) is handled by the
 * parent via `onRestore`.
 */
export default function VersionHistory({
  open,
  onClose,
  apiType,
  id,
  currentVersionId,
  busy,
  onRestore,
}: {
  open: boolean;
  onClose: () => void;
  apiType: string;
  id: string;
  currentVersionId: string | null;
  busy: boolean;
  onRestore: (versionId: string) => void;
}) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    fetch(`/api/admin/${apiType}/${id}/versions`)
      .then((r) => r.json())
      .then((b) => setVersions(b.versions ?? []))
      .catch(() => setError("Could not load the version history."))
      .finally(() => setLoading(false));
  }, [apiType, id]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Version history"
      description="Restore a previous saved version. Any unsaved changes on screen are saved first."
    >
      {error && (
        <StatusMessage tone="error" className="mb-3">
          {error}
        </StatusMessage>
      )}

      {loading ? (
        <Skeleton rows={4} />
      ) : versions.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">
          No saved versions yet.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {versions.map((v) => {
            const isCurrent = v.id === currentVersionId;
            return (
              <li
                key={v.id}
                className="flex items-center justify-between gap-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-ink">
                    {formatWhen(v.createdAt)}
                  </p>
                  <p className="text-xs text-muted">
                    {v.authorEmail ?? "Unknown"} · {v.statusAtSave}
                    {isCurrent ? " · current" : ""}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy || isCurrent}
                  onClick={() => onRestore(v.id)}
                  className={`${buttonSecondary} shrink-0 disabled:opacity-50`}
                >
                  {isCurrent ? "Current" : "Restore"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
