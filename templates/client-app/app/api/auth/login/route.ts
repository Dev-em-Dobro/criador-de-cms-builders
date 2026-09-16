import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit/log";
import {
  jsonError,
  jsonOk,
  checkRateLimit,
  clientMeta,
  handleError,
} from "@/lib/http";

/**
 * Step one of sign-in: password only. Establishes an aal1 session.
 *
 * The response carries `next` so the client knows where to go:
 *   "mfa"   — a verified factor exists, complete the challenge
 *   "enrol" — no factor yet, go and enrol one (bootstrap)
 *   "done"  — signed in, nothing further required
 *
 * There is no longer a `challengeId`: the custom 5-minute challenge JWT is
 * retired, and the pending challenge is resolved server-side from the session.
 */
export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();
    if (typeof email !== "string" || typeof password !== "string") {
      return jsonError(422, "email and password are required");
    }

    const ip = req.headers.get("x-forwarded-for") ?? "unknown";
    if (!checkRateLimit(`login:${ip}:${email}`, 10, 60_000)) {
      await writeAudit({
        action: "auth.login_rate_limited",
        metadata: { email, ...clientMeta(req) },
      });
      return jsonError(429, "Too many attempts, try again later");
    }

    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.toLowerCase().trim(),
      password,
    });

    if (error || !data.user) {
      await writeAudit({
        action: "auth.login_fail",
        metadata: { email, reason: "bad-credentials", ...clientMeta(req) },
      });
      return jsonError(401, "Invalid credentials");
    }

    const [profile] = await db
      .select()
      .from(profiles)
      .where(eq(profiles.id, data.user.id));

    // A disabled account is refused with the same message as bad credentials,
    // so the response does not reveal that the account exists.
    if (!profile || profile.status === "disabled") {
      await supabase.auth.signOut({ scope: "local" });
      await writeAudit({
        actorId: profile?.id,
        actorEmail: profile?.email,
        action: "auth.login_fail",
        metadata: { reason: "disabled-or-missing-profile", ...clientMeta(req) },
      });
      return jsonError(401, "Invalid credentials");
    }

    // Distinguish "no factor enrolled" from "factor not satisfied yet". Both
    // present as aal1 and need opposite handling — enrol vs. challenge.
    const { data: factors } = await supabase.auth.mfa.listFactors();
    const verified = factors?.totp?.filter((f) => f.status === "verified") ?? [];

    if (verified.length === 0) {
      await writeAudit({
        actorId: profile.id,
        actorEmail: profile.email,
        action: "auth.bootstrap_enter",
        metadata: clientMeta(req),
      });
      return jsonOk({ ok: true, next: "enrol" });
    }

    return jsonOk({ ok: true, next: "mfa", factorId: verified[0].id });
  } catch (e) {
    return handleError(e);
  }
}
