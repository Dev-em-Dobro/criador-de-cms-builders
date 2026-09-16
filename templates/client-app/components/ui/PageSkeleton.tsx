/**
 * Instant navigation feedback for the admin. Rendered by the route-segment
 * `loading.tsx` files the moment a navigation starts, while the server
 * component behind it is still fetching — the nav shell stays interactive.
 *
 * Two shapes cover every admin surface: "list" (heading + action + rows) and
 * "editor" (heading + stacked form fields). Announced to screen readers once
 * via role="status"; the pulsing blocks themselves are decorative.
 */

function Bar({ className }: { className: string }) {
  return <div aria-hidden className={`animate-pulse rounded bg-paper ${className}`} />;
}

export default function PageSkeleton({
  variant = "list",
}: {
  variant?: "list" | "editor";
}) {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">Loading page…</span>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Bar className="h-8 w-48" />
        <Bar className="h-11 w-24" />
      </div>

      {variant === "list" ? (
        <div className="overflow-hidden rounded-lg border border-line-strong">
          {[...Array(6)].map((_, i) => (
            <div
              key={i}
              className={`flex items-center justify-between gap-4 p-4 ${i > 0 ? "border-t border-line-strong" : ""}`}
            >
              <div className="min-w-0 flex-1">
                <Bar className="h-4 w-2/5 max-w-56" />
                <Bar className="mt-2 h-3 w-1/4 max-w-32" />
              </div>
              <Bar className="h-6 w-20 shrink-0" />
            </div>
          ))}
        </div>
      ) : (
        <div className="max-w-2xl space-y-5">
          {[...Array(5)].map((_, i) => (
            <div key={i}>
              <Bar className="h-4 w-28" />
              <Bar className="mt-2 h-11 w-full" />
            </div>
          ))}
          <Bar className="h-28 w-full" />
        </div>
      )}
    </div>
  );
}
