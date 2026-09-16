import { NextRequest } from "next/server";
import { db } from "@/db";
import { leads } from "@/db/schema";
import { leadInputSchema } from "@/lib/leads/schema";
import { dispatchLeadWebhook } from "@/lib/leads/webhook";
import {
  jsonOk,
  jsonError,
  jsonValidationError,
  readKeyValid,
  secretEquals,
  checkRateLimit,
  clientMeta,
  handleError,
} from "@/lib/http";

/**
 * Authorise a lead ingest request. Prefers a dedicated `LEAD_INGEST_KEY` so lead
 * capture can be scoped separately from the read API; falls back to the read key
 * (`READ_API_KEY`) the site already sends when the dedicated key is unset.
 */
function leadKeyValid(req: Request): boolean {
  const dedicated = process.env.LEAD_INGEST_KEY;
  if (dedicated) return secretEquals(req.headers.get("x-api-key"), dedicated);
  return readKeyValid(req);
}

/**
 * POST /api/leads — capture a contact-form lead from the marketing site.
 * Auth via x-api-key, IP rate-limited, body re-validated server-side.
 */
export async function POST(req: NextRequest) {
  try {
    if (!leadKeyValid(req)) return jsonError(401, "Invalid API key");

    const { ip, userAgent } = clientMeta(req);
    if (!checkRateLimit(`leads:${ip}`, 5, 60_000)) {
      return jsonError(429, "Too many requests");
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return jsonError(400, "Invalid JSON body");
    }

    const parsed = leadInputSchema.safeParse(body);
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        errors[issue.path.join(".") || "_"] = issue.message;
      }
      return jsonValidationError(errors);
    }
    const lead = parsed.data;

    const [row] = await db
      .insert(leads)
      .values({
        name: lead.name,
        email: lead.email,
        organisation: lead.organisation,
        message: lead.message,
        source: lead.source,
        // Fall back to the request's own referer / UA when the client omits them.
        referer: lead.referer ?? req.headers.get("referer"),
        userAgent: lead.user_agent ?? userAgent,
      })
      .returning({ id: leads.id });

    // Optional downstream forward — never blocks or fails the write (nice-to-have).
    void dispatchLeadWebhook({ id: row.id, ...lead });

    return jsonOk({ ok: true, id: row.id });
  } catch (e) {
    return handleError(e);
  }
}
