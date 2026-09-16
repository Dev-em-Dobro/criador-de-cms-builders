import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit/log";
import { jsonError, jsonOk, clientMeta, handleError } from "@/lib/http";

/**
 * Step two of sign-in: satisfy the second factor, elevating the session to
 * aal2. Takes only a code — the pending factor is resolved from the session.
 */
export async function POST(req: NextRequest) {
  try {
    const { code } = await req.json();
    if (typeof code !== "string") {
      return jsonError(422, "code is required");
    }

    const supabase = await createClient();
    const { data: claimsData } = await supabase.auth.getClaims();
    const sub = claimsData?.claims?.sub;
    if (!sub) return jsonError(401, "Sign in with your password first");

    const { data: factors } = await supabase.auth.mfa.listFactors();
    const factor = factors?.totp?.find((f) => f.status === "verified");
    if (!factor) return jsonError(403, "No second factor enrolled");

    const { error } = await supabase.auth.mfa.challengeAndVerify({
      factorId: factor.id,
      code,
    });

    if (error) {
      await writeAudit({
        actorId: sub,
        action: "auth.mfa_fail",
        metadata: clientMeta(req),
      });
      /**
       * Supabase rate-limits challenge/verify to 15 per hour PER IP ADDRESS —
       * not per user, and not configurable. Everyone behind the same office
       * NAT shares that budget, so a generic "try again later" would be
       * actively misleading about who is affected and for how long.
       */
      if (error.status === 429) {
        return jsonError(
          429,
          "Too many code attempts. This limit is shared by everyone on your network and resets within the hour.",
        );
      }
      return jsonError(401, "Invalid code");
    }

    const [profile] = await db
      .update(profiles)
      .set({ lastLoginAt: new Date() })
      .where(eq(profiles.id, sub))
      .returning();

    await writeAudit({
      actorId: sub,
      actorEmail: profile?.email,
      action: "auth.login",
      metadata: { mfa: true, ...clientMeta(req) },
    });
    return jsonOk({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
