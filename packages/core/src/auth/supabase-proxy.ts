// @cms-core/core/auth — refresh de sessão Supabase no proxy/middleware (S1.3b).
// Movido de clients/demo-corp/lib/supabase/proxy.ts SEM alteração.

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase session cookie on every request.
 *
 * Server Components cannot write cookies, so this is what actually persists a
 * refreshed access token. This deliberately does NOT redirect or authorize —
 * real enforcement lives in the guards, called explicitly per route.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  // Do not hoist this client. Fluid Compute reuses instances across concurrent
  // requests; a shared client would cross sessions between users.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Nothing may go between createServerClient and getClaims(). Code inserted
  // here causes intermittent, very hard to trace sign-outs.
  await supabase.auth.getClaims();

  // Return this exact response object. Building a new one without copying the
  // cookies over desynchronises browser and server and terminates the session.
  return supabaseResponse;
}
