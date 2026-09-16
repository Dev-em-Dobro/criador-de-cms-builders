import { NextRequest, NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * Callback for email-delivered links — invitation acceptance, password
 * recovery, email confirmation.
 *
 * This is the `token_hash` flow (`verifyOtp`), NOT `exchangeCodeForSession`:
 * the emails carry a hashed token, and verifying it here establishes the
 * session cookie server-side before the redirect.
 */

const OTP_TYPES: EmailOtpType[] = [
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
];

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const tokenHash = url.searchParams.get("token_hash");
  const typeParam = url.searchParams.get("type");
  const nextParam = url.searchParams.get("next");

  const type = OTP_TYPES.find((t) => t === typeParam);

  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      /**
       * Invitees and recoverers both land on the set-password screen: an
       * invited user has no password yet, and a recovery link exists to
       * replace one. Everything else goes home and lets the guards route
       * (bootstrap -> enrolment, unsatisfied factor -> challenge).
       * Only relative paths are honoured — this must not be an open redirect.
       */
      const fallback =
        type === "invite" || type === "recovery" ? "/auth/update-password" : "/";
      const next =
        nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//")
          ? nextParam
          : fallback;
      return NextResponse.redirect(new URL(next, req.url));
    }
  }

  // Used, expired, or malformed link. Same destination for all three — the
  // reason is not actionable for the person clicking, requesting a fresh link is.
  return NextResponse.redirect(new URL("/login?error=invalid-link", req.url));
}
