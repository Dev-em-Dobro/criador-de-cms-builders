import { NextRequest } from "next/server";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit/log";
import {
  jsonOk,
  jsonError,
  checkRateLimit,
  clientMeta,
  handleError,
} from "@/lib/http";

/**
 * Request a password-recovery email.
 *
 * ALWAYS returns 200 with the same body, whether or not the address is
 * registered (FR-017): a different answer would let anyone probe which emails
 * have accounts. The actual send runs after the response is flushed, so
 * observable timing does not depend on whether an email went out either.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const email = typeof body?.email === "string" ? body.email.toLowerCase().trim() : null;

    const ip = req.headers.get("x-forwarded-for") ?? "unknown";
    if (!checkRateLimit(`recover:${ip}`, 5, 60_000)) {
      return jsonError(429, "Too many attempts, try again later");
    }

    if (email && email.includes("@")) {
      const origin = new URL(req.url).origin;
      const meta = clientMeta(req);
      const supabase = await createClient();
      const send = async () => {
        // Errors (unknown address, SMTP limits) are swallowed on purpose —
        // surfacing them would recreate the enumeration channel.
        await supabase.auth
          .resetPasswordForEmail(email, {
            redirectTo: `${origin}/auth/confirm?next=/auth/update-password`,
          })
          .catch(() => {});
        await writeAudit({
          action: "auth.password_reset_requested",
          metadata: { email, ...meta },
        }).catch(() => {});
      };
      try {
        // Defer past the response so timing is identical for all inputs.
        after(send);
      } catch {
        // Outside a Next request scope (tests) `after` is unavailable —
        // fire-and-forget keeps the same response-timing property.
        void send();
      }
    }

    return jsonOk({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
