import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit/log";
import { clientMeta } from "@/lib/http";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;

  // `scope: 'local'` is deliberate and must not be dropped. Supabase defaults
  // to 'global', which would sign the user out of every device they own — a
  // silent regression from the previous per-session logout.
  await supabase.auth.signOut({ scope: "local" });

  if (sub)
    await writeAudit({
      actorId: sub,
      action: "auth.logout",
      metadata: clientMeta(req),
    });
  return NextResponse.redirect(new URL("/login", req.url));
}
