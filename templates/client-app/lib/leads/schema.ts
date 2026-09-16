import { z } from "zod";

/**
 * Server-side validation for an inbound lead (POST /api/leads).
 *
 * The client is never trusted: every field is re-validated and normalised here
 * regardless of what the site sent. Strings are trimmed, `email` is lowercased,
 * and optional fields collapse blank/whitespace input to `null`.
 */

/** Required text: trim first, then enforce the length bounds. */
function requiredText(min: number, max: number) {
  return z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : v),
    z.string().min(min).max(max),
  );
}

/** Optional text: absent / blank / whitespace-only all become `null`. */
function optionalText(max: number) {
  return z.preprocess(
    (v) => (v == null ? null : String(v).trim() || null),
    z.string().max(max).nullable(),
  );
}

export const leadInputSchema = z.object({
  name: requiredText(1, 200),
  email: z.preprocess(
    (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
    z.email().max(320),
  ),
  organisation: optionalText(200),
  message: requiredText(1, 5000),
  // Page path+query the form was submitted from (may carry UTM params).
  source: optionalText(500),
  referer: optionalText(2000),
  user_agent: optionalText(2000),
});

export type LeadInput = z.infer<typeof leadInputSchema>;
