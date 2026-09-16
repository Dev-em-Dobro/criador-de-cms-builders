/** @type {import('next').NextConfig} */

/**
 * Origin allowed to call the read API from a browser.
 *
 * Accepts `SITE_URL` as well as `SITE_ORIGIN`: deployments tend to carry the
 * former, and reading only the latter silently fell back to `"*"`, letting any
 * site call the read API. Returns `null` when neither is set — the CORS header
 * is then omitted entirely, so the browser blocks by default. Server-side
 * fetches (what a site actually uses) never involve CORS either way.
 */
function resolveSiteOrigin() {
  const raw = process.env.SITE_ORIGIN ?? process.env.SITE_URL ?? "";
  if (!raw) return null;
  if (raw === "*") return "*";
  try {
    return new URL(raw).origin;
  } catch {
    return raw;
  }
}

const SITE_ORIGIN = resolveSiteOrigin();

/**
 * Admin CSP. `unsafe-inline` on script/style is the cost of Next without a
 * nonce — the rest still earns its place: even a successful XSS cannot ship the
 * data out (`connect-src`), frame the panel elsewhere (`frame-ancestors`) or
 * rewrite the base of relative URLs (`base-uri`), which is how admin sessions
 * actually get stolen.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co https://*.vercel-storage.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

// (D1 monorepo — ADR-001 Decisão 2) `@cms-core/core` é um nome de pacote válido
// (escopo + nome) linkado por workspace:* . Os subpaths (`@cms-core/core/engine`
// etc.) resolvem NATIVAMENTE pelo campo `exports` do package.json do core.
//
// (ADR-004 / S2.8) O core agora é BUILDADO (`tsc → dist/`): em produção o
// `next build` (Turbopack) consome `dist/*.js` reais via a condição `default`
// dos `exports`; em dev/test lê `src` via a condição `development`. Por isso
// `transpilePackages:["@cms-core/core"]` foi REMOVIDO — não é mais necessário
// (o Turbopack resolve `.js` reais nativamente, como qualquer pacote npm).

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  // The CMS is a private admin tool — keep it out of every search index. This
  // HTTP header covers non-HTML routes too and, unlike a robots.txt Disallow,
  // still lets crawlers fetch the page and SEE the noindex (a Disallow would
  // hide it, leaving a stale URL-only listing). Pairs with the `robots` meta in
  // app/layout.tsx.
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
  { key: "Content-Security-Policy", value: CSP },
];

const nextConfig = {
  async headers() {
    return [
      // Baseline security headers on every route.
      { source: "/:path*", headers: securityHeaders },
      // CORS for the published read API so browsers on the site's origin may
      // call it directly if needed (server-side fetches don't require this).
      // Omitted entirely when no origin is configured — see resolveSiteOrigin().
      ...(SITE_ORIGIN
        ? [
            {
              source: "/api/content/:path*",
              headers: [
                { key: "Access-Control-Allow-Origin", value: SITE_ORIGIN },
                { key: "Access-Control-Allow-Methods", value: "GET, OPTIONS" },
                { key: "Access-Control-Allow-Headers", value: "x-api-key" },
                // Without this an intermediate cache may serve one origin's
                // response to another.
                { key: "Vary", value: "Origin" },
              ],
            },
          ]
        : []),
    ];
  },
};

export default nextConfig;
