import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { mediaAssets } from "@/db/schema";
import { requireSession } from "@/lib/core-runtime";
import { mediaStorage } from "@/lib/media-storage";
import { writeAudit } from "@/lib/audit/log";
import { jsonOk, jsonError, handleError } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const session = await requireSession();
    const { id } = await ctx.params;
    const [asset] = await db
      .select()
      .from(mediaAssets)
      .where(eq(mediaAssets.id, id));
    if (!asset) return jsonError(404, "Media not found");

    // Best-effort: o registro sai do banco mesmo se o provedor recusar a
    // exclusão — um órfão no storage é melhor que uma referência quebrada.
    const storage = await mediaStorage();
    await storage.delete(asset.storagePath).catch(() => {});
    await db.delete(mediaAssets).where(eq(mediaAssets.id, id));
    await writeAudit({
      actorId: session.sub,
      action: "media.delete",
      targetType: "media",
      targetId: id,
    });
    return jsonOk({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
