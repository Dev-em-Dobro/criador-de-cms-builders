// @cms-core/core/auth — cliente Supabase privilegiado (service role) (S1.3b).
// Movido de clients/demo-corp/lib/supabase/admin.ts SEM alteração.

import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Privileged Supabase client for administrative operations: inviting users,
 * deleting MFA factors, banning accounts.
 *
 * This key bypasses every authorization check in the project. The `server-only`
 * import above makes the build fail if this module is ever reached from a client
 * component. Never expose the key through a NEXT_PUBLIC_ variable.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_URL are required for admin operations",
    );
  }

  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
