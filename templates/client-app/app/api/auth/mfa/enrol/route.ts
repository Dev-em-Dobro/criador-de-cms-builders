import { createClient } from "@/lib/supabase/server";
import clientConfig from "@/client.config";
import { requireEnrolmentBootstrap } from "@/lib/core-runtime";
import { jsonError, jsonOk, handleError } from "@/lib/http";

/**
 * Begin second-factor enrolment. Reachable only from the bootstrap state — an
 * authenticated session with no verified factor.
 *
 * Supabase returns the QR as SVG alongside the raw secret, so no QR library is
 * needed on our side.
 */
export async function POST() {
  try {
    const session = await requireEnrolmentBootstrap();
    const supabase = await createClient();

    /**
     * Clear any leftover unverified factor before enrolling a new one.
     *
     * `enroll()` creates an unverified factor immediately, and Supabase
     * documents no expiry or garbage collection for those. A user who starts
     * enrolment and abandons it repeatedly would otherwise accumulate factors
     * until they hit the cap of 10 — at which point enrolment breaks
     * permanently, with an error that points nowhere near the cause.
     */
    const { data: existing } = await supabase.auth.mfa.listFactors();
    for (const stale of existing?.all?.filter((f) => f.status === "unverified") ?? []) {
      await supabase.auth.mfa.unenroll({ factorId: stale.id });
    }

    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: `${clientConfig.branding.adminTitle} CMS (${session.email})`,
      /**
       * Without this the issuer is derived from the project's Site URL, so the
       * authenticator app lists the account as "localhost:3000" — meaningless
       * to the user and liable to collide across environments. The parameter
       * is undocumented; verified by inspecting the returned otpauth URI.
       */
      issuer: `${clientConfig.branding.adminTitle} CMS`,
    });

    if (error) {
      if (error.status === 429) {
        return jsonError(
          429,
          "Too many enrolment attempts. This limit is shared by everyone on your network and resets within the hour.",
        );
      }
      return jsonError(400, error.message);
    }

    return jsonOk({
      factorId: data.id,
      qrCodeSvg: data.totp.qr_code,
      secret: data.totp.secret,
      uri: data.totp.uri,
    });
  } catch (e) {
    return handleError(e);
  }
}
