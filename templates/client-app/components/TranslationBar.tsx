"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { StatusMessage, LoadingOverlay } from "@cms-core/core/ui";

interface Variant {
  id: string;
  locale: string;
  status: string;
}

/**
 * Language bar for the editor: shows the current language, switches to the
 * other existing languages, and creates a missing one. Switching and creating
 * both navigate; while that navigation loads, the screen is locked behind a
 * loading overlay so the click feels immediate and no double-action slips in.
 */
export default function TranslationBar({
  apiType,
  id,
  currentLocale,
  existing,
  active,
  kind,
  collection,
  pageKey,
  defaultLocale,
}: {
  apiType: string;
  id: string;
  currentLocale: string;
  existing: Variant[];
  active: { code: string; label: string }[];
  kind: "collection" | "singleton";
  collection?: string;
  pageKey?: string;
  defaultLocale?: string;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  /**
   * Num CMS de um idioma só, esta barra não tem função: não há para onde trocar
   * nem tradução a criar — sobra o rótulo "Languages" ocupando o topo do editor.
   * Volta a aparecer sozinha assim que um segundo idioma for ativado em
   * `/settings/languages`. Os hooks acima já rodaram, então o early return não
   * quebra a ordem de hooks.
   */
  if (active.length <= 1) return null;

  // True from the click until the target language's page has loaded.
  const loading = creating || pending;
  const byLocale = new Map(existing.map((v) => [v.locale, v]));

  function hrefFor(locale: string, entryId: string) {
    return kind === "collection"
      ? `/${collection}/${entryId}`
      : `/pages/${pageKey}?locale=${locale}`;
  }

  function switchTo(href: string) {
    startTransition(() => router.push(href));
  }

  async function create(code: string) {
    setCreating(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/${apiType}/${id}/translate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ locale: code }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.id) {
        setError(
          body.fields?.locale ?? body.error ?? "Could not create the translation.",
        );
        return;
      }
      // Keep the overlay up through the navigation to the new entry.
      startTransition(() => router.push(hrefFor(code, body.id)));
    } catch {
      setError("Could not reach the server.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="mb-5 rounded-lg border border-line-strong bg-paper/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">
          Languages
        </span>
        {active.map((l) => {
          const variant = byLocale.get(l.code);
          const isCurrent = l.code === currentLocale;

          if (variant) {
            return isCurrent ? (
              <span
                key={l.code}
                aria-current="true"
                className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold text-ink shadow-sm"
              >
                {l.label}
                <span className="font-normal text-muted">(current)</span>
              </span>
            ) : (
              <button
                key={l.code}
                type="button"
                disabled={loading}
                onClick={() => switchTo(hrefFor(l.code, variant.id))}
                className="inline-flex items-center rounded-full border border-line-strong px-2.5 py-0.5 text-xs text-ink transition-colors duration-150 hover:border-brand-dark disabled:opacity-50"
              >
                {l.label}
              </button>
            );
          }

          return (
            <button
              key={l.code}
              type="button"
              disabled={loading}
              onClick={() => create(l.code)}
              className="inline-flex items-center gap-1 rounded-full border border-dashed border-line-strong px-2.5 py-0.5 text-xs text-muted transition-colors duration-150 hover:border-brand-dark hover:text-ink disabled:opacity-50"
            >
              <span aria-hidden="true">+</span> {l.label}
              <span className="sr-only"> (create translation)</span>
            </button>
          );
        })}
      </div>

      {defaultLocale &&
        currentLocale !== defaultLocale &&
        existing.some((v) => v.locale === defaultLocale) && (
          <p className="mt-2 text-xs text-muted">
            Translated from{" "}
            {active.find((l) => l.code === defaultLocale)?.label ?? defaultLocale}{" "}
            — fields start pre-filled from the source; translate over them.
          </p>
        )}

      {error && (
        <StatusMessage tone="error" className="mt-2">
          {error}
        </StatusMessage>
      )}

      {/* Lock the screen while the target language loads. */}
      <LoadingOverlay show={loading} message="Loading language…" />
    </div>
  );
}
