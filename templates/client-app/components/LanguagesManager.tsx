"use client";

import { useEffect, useState } from "react";
import {
  StatusMessage,
  Skeleton,
  LoadingOverlay,
  buttonPrimary,
  buttonSecondary,
  buttonDanger,
  input,
} from "@cms-core/core/ui";
import { useConfirm } from "./ui/useConfirm";

interface LocaleRow {
  code: string;
  label: string;
  isDefault: boolean;
  enabled: boolean;
  sortOrder: number;
}

export default function LanguagesManager() {
  const [locales, setLocales] = useState<LocaleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [working, setWorking] = useState(false); // any row action in flight
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirm, confirmDialog] = useConfirm();

  function load() {
    setLoading(true);
    fetch("/api/admin/locales")
      .then((r) => r.json())
      .then((b) => setLocales(b.locales ?? []))
      .catch(() => setError("Could not load languages."))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const res = await fetch("/api/admin/locales", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: code.trim(), label: label.trim() }),
      });
      const b = await res.json();
      if (!res.ok) return setError(b.error ?? "Could not add the language.");
      setNotice(`${label} added.`);
      setCode("");
      setLabel("");
      load();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  async function patch(code: string, body: Record<string, unknown>, ok: string) {
    setError("");
    setNotice("");
    setWorking(true);
    try {
      const res = await fetch(`/api/admin/locales/${code}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const b = await res.json();
      if (!res.ok) return setError(b.error ?? "Update failed.");
      setNotice(ok);
      load();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setWorking(false);
    }
  }

  async function renameIfChanged(l: LocaleRow, next: string) {
    const trimmed = next.trim();
    if (!trimmed || trimmed === l.label) return;
    patch(l.code, { label: trimmed }, `${l.code} renamed.`);
  }

  async function remove(l: LocaleRow) {
    const ok = await confirm({
      title: `Delete ${l.label} (${l.code})?`,
      description:
        "This removes the language from the registry. Only languages with no content can be deleted — otherwise disable it instead.",
      confirmLabel: "Delete language",
      destructive: true,
    });
    if (!ok) return;
    setError("");
    setNotice("");
    setWorking(true);
    try {
      const res = await fetch(`/api/admin/locales/${l.code}`, { method: "DELETE" });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) return setError(b.error ?? "Could not delete the language.");
      setNotice(`${l.label} deleted.`);
      load();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-ink">Languages</h1>
      <p className="mb-5 text-sm text-muted">
        The languages editors can create and translate content in. One is the
        default (used as the fallback).
      </p>

      <form
        onSubmit={add}
        className="mb-6 max-w-3xl rounded-lg border border-line-strong p-5"
      >
        <h2 className="text-sm font-semibold text-ink">Add a language</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="new-code" className="text-sm font-medium text-ink">
              Code
            </label>
            <input
              id="new-code"
              className={input}
              placeholder="e.g. pt-BR, es, fr"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="new-label" className="text-sm font-medium text-ink">
              Name
            </label>
            <input
              id="new-label"
              className={input}
              placeholder="e.g. Português (Brasil)"
              required
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
        </div>
        <div className="mt-5 flex justify-end border-t border-line pt-4">
          <button disabled={busy} aria-busy={busy} className={buttonPrimary}>
            {busy ? "Adding…" : "Add language"}
          </button>
        </div>
      </form>

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
        <Skeleton rows={3} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line-strong">
          <table className="w-full min-w-[40rem] text-sm">
            <caption className="sr-only">
              Registered languages with their default, status, and actions
            </caption>
            <thead className="bg-paper text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th scope="col" className="px-4 py-2 font-semibold">Code</th>
                <th scope="col" className="px-4 py-2 font-semibold">Name</th>
                <th scope="col" className="px-4 py-2 font-semibold">Default</th>
                <th scope="col" className="px-4 py-2 font-semibold">Status</th>
                <th scope="col" className="px-4 py-2 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {locales.map((l) => (
                <tr key={l.code} className="border-t border-line">
                  <th scope="row" className="px-4 py-2 text-left font-mono text-ink">
                    {l.code}
                  </th>
                  <td className="px-4 py-2">
                    <input
                      defaultValue={l.label}
                      aria-label={`Name for ${l.code}`}
                      className={input}
                      onBlur={(e) => renameIfChanged(l, e.target.value)}
                    />
                  </td>
                  <td className="px-4 py-2">
                    {l.isDefault ? (
                      <span className="rounded-full bg-success-surface px-2 py-0.5 text-xs font-medium text-success">
                        Default
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={!l.enabled}
                        onClick={() =>
                          patch(l.code, { isDefault: true }, `${l.code} is now the default.`)
                        }
                        className={`${buttonSecondary} disabled:opacity-50`}
                        title={l.enabled ? undefined : "Enable it first"}
                      >
                        Set default
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <button
                      type="button"
                      onClick={() =>
                        patch(
                          l.code,
                          { enabled: !l.enabled },
                          `${l.code} ${l.enabled ? "disabled" : "enabled"}.`,
                        )
                      }
                      className={buttonSecondary}
                    >
                      {l.enabled ? "Enabled" : "Disabled"}
                    </button>
                  </td>
                  <td className="px-4 py-2">
                    <button
                      type="button"
                      onClick={() => remove(l)}
                      className={buttonDanger}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {confirmDialog}
      <LoadingOverlay show={busy || working} message="Saving…" />
    </div>
  );
}
