"use client";

/**
 * @cms-core/core/ui — full-screen loading lock (movido de
 * clients/demo-corp/components/ui/LoadingOverlay.tsx em S2.6). Genérico.
 *
 * Standard full-screen loading lock, used across the CMS for any blocking
 * action (saving, deleting, uploading, navigating). Dark scrim + a centered
 * card with a spinner. Render it conditionally with `show`.
 */

import { useCoreStrings } from "./strings.js";

export default function LoadingOverlay({
  show,
  message,
}: {
  show: boolean;
  /** Texto do lock. Sem valor, usa "carregando" do dicionário vigente. */
  message?: string;
}) {
  const t = useCoreStrings();
  if (!show) return null;
  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-black/50"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-3 rounded-lg border border-line-strong bg-white px-4 py-3 shadow-xl">
        <span
          className="h-4 w-4 animate-spin rounded-full border-2 border-line-strong border-t-brand-dark"
          aria-hidden="true"
        />
        <span className="text-sm font-medium text-ink">
          {message ?? t.loading}
        </span>
      </div>
    </div>
  );
}
