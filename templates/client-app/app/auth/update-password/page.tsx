import clientConfig from "@/client.config";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import UpdatePasswordForm from "./UpdatePasswordForm";

/**
 * Set a new password. Reached from a recovery link or an invitation (both
 * arrive via /auth/confirm with a session already established), or by a
 * signed-in user changing their password deliberately.
 *
 * Requires SOME session — anonymous visitors have nothing to update. Assurance
 * is enforced by the API route, not here: an account with a verified factor
 * must satisfy it before the password actually changes, and the form walks the
 * user through that challenge inline.
 */
export default async function UpdatePasswordPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) redirect("/login");
  return <UpdatePasswordForm brandTitle={clientConfig.branding.adminTitle} />;
}
