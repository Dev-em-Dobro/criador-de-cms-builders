import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { createClient } from "@/lib/supabase/server";
import { requireEnrolmentBootstrap } from "@/lib/core-runtime";
import { writeAudit } from "@/lib/audit/log";
import { jsonError, jsonOk, clientMeta, handleError } from "@/lib/http";

/**
 * Confirm enrolment by verifying a code from the authenticator app. On success
 * the factor becomes verified and the session is elevated to aal2.
 *
 * Supabase signs the user out of all OTHER sessions at this point. That is
 * expected behaviour, not a bug.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireEnrolmentBootstrap();
    const { factorId, code } = await req.json();
    if (typeof factorId !== "string" || typeof code !== "string") {
      return jsonError(422, "factorId and code are required");
    }

    const supabase = await createClient();
    const { error } = await supabase.auth.mfa.challengeAndVerify({
      factorId,
      code,
    });

    if (error) {
      await writeAudit({
        actorId: session.sub,
        actorEmail: session.email,
        action: "auth.mfa_fail",
        metadata: { during: "enrolment", ...clientMeta(req) },
      });
      if (error.status === 429) {
        return jsonError(
          429,
          "Too many code attempts. This limit is shared by everyone on your network and resets within the hour.",
        );
      }
      return jsonError(401, "Invalid code");
    }

    // An invited user becomes active once they hold a working second factor.
    await db
      .update(profiles)
      .set({ status: "active", lastLoginAt: new Date(), updatedAt: new Date() })
      .where(eq(profiles.id, session.sub));

    await writeAudit({
      actorId: session.sub,
      actorEmail: session.email,
      action: "auth.mfa_enrolled",
      metadata: clientMeta(req),
    });
    await writeAudit({
      actorId: session.sub,
      actorEmail: session.email,
      action: "auth.bootstrap_exit",
    });

    return jsonOk({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
