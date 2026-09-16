import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/core-runtime";
import { listAudit } from "@/lib/audit/log";
import { jsonOk, handleError } from "@/lib/http";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(); // admin-only (FR-016)
    const sp = new URL(req.url).searchParams;
    const items = await listAudit({
      action: sp.get("action") ?? undefined,
      targetType: sp.get("targetType") ?? undefined,
      actorId: sp.get("actorId") ?? undefined,
      limit: Number(sp.get("limit") ?? 100),
      offset: Number(sp.get("offset") ?? 0),
    });
    return jsonOk({ items });
  } catch (e) {
    return handleError(e);
  }
}
