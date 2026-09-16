// @cms-core/core/auth — cliente Supabase de browser (S1.3b).
// Movido de clients/demo-corp/lib/supabase/client.ts SEM alteração.

import { createBrowserClient } from "@supabase/ssr";

/** Browser-side Supabase client. Safe to use in client components. */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
