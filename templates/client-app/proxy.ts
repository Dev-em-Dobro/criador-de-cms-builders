import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

/**
 * Next.js 16 renamed the `middleware` file convention to `proxy`. This runs on
 * the Node.js runtime by default.
 *
 * Its only job is refreshing the Supabase session cookie — see
 * lib/supabase/proxy.ts for why authorization is not done here.
 */
export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // Skip the media upload route: the proxy buffers request bodies and would
    // truncate uploads at 10MB, breaking multipart parsing. It only refreshes
    // the session cookie, which the upload handler doesn't need.
    "/((?!_next/static|_next/image|favicon.ico|api/media|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
