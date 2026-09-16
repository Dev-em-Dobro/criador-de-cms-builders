import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit/log";
import { jsonOk, jsonError, clientMeta, handleError } from "@/lib/http";

/**
 * Set a new password for the signed-in user — the landing action for both the
 * recovery-link flow and an in-session change.
 *
 * A recovery link must never be a way around MFA: `verifyOtp` grants only an
 * aal1 session, so for an account with a verified factor this route demands
 * aal2 before it will touch the password. The client completes the challenge
 * (`POST /api/auth/mfa`) and retries. Accounts with no factor (fresh invitees)
 * proceed at aal1 and hit enrolment right after.
 */
export async function POST(req: NextRequest) {
  try {
    const { password, currentPassword } = await req.json();
    if (typeof password !== "string" || password.length === 0) {
      return jsonError(422, "password is required");
    }

    const supabase = await createClient();
    const { data: claimsData } = await supabase.auth.getClaims();
    const claims = claimsData?.claims;
    if (!claims?.sub) return jsonError(401, "Authentication required");

    const { data: factors } = await supabase.auth.mfa.listFactors();
    const verified = factors?.totp?.filter((f) => f.status === "verified") ?? [];
    if (verified.length > 0 && claims.aal !== "aal2") {
      return jsonError(403, "Second factor required", { next: "mfa" });
    }

    const { error } = await supabase.auth.updateUser({
      password,
      // When the caller is already signed in and supplies it, the old password
      // is re-verified server-side (project-level GoTrue setting permitting).
      ...(typeof currentPassword === "string" && currentPassword.length > 0
        ? { current_password: currentPassword }
        : {}),
    });

    if (error) {
      if (error.status === 422) return jsonError(422, error.message);
      return jsonError(400, error.message);
    }

    const actorEmail = typeof claims.email === "string" ? claims.email : null;
    await writeAudit({
      actorId: claims.sub,
      actorEmail,
      action: "auth.password_changed",
      metadata: clientMeta(req),
    });
    // Changing the password revokes the account's other sessions (Supabase).
    await writeAudit({
      actorId: claims.sub,
      actorEmail,
      action: "auth.session_revoked",
      metadata: { reason: "password_changed", ...clientMeta(req) },
    });

    return jsonOk({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
