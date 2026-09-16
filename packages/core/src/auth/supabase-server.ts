// @cms-core/core/auth — cliente Supabase de servidor (SSR-aware) (S1.3b).
// Movido de clients/demo-corp/lib/supabase/server.ts SEM alteração.

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Server-side Supabase client, scoped to the current request's cookies.
 *
 * Always create a new client inside the function that uses it — never hoist it
 * to a module-level variable. Fluid Compute reuses instances across concurrent
 * requests, so a shared client would leak one user's session into another's.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server Components cannot write cookies. Safe to ignore: the
            // proxy refreshes the session on every request, so the token is
            // still persisted there.
          }
        },
      },
    },
  );
}
