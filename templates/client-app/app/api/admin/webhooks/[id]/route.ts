import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { webhookEndpoints } from "@/db/schema";
import { requireAdmin } from "@/lib/core-runtime";
import { writeAudit } from "@/lib/audit/log";
import { jsonOk, handleError } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, ctx: Ctx) {
  try {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const body = await req.json();
    const set: Partial<typeof webhookEndpoints.$inferInsert> = {};
    if (typeof body.url === "string") set.url = body.url;
    if (typeof body.active === "boolean") set.active = body.active;
    if (Array.isArray(body.events)) set.events = body.events;

    const [updated] = await db
      .update(webhookEndpoints)
      .set(set)
      .where(eq(webhookEndpoints.id, id))
      .returning();

    await writeAudit({
      actorId: admin.sub,
      action: "webhook.update",
      targetType: "webhook",
      targetId: id,
      metadata: set,
    });
    return jsonOk({
      id: updated.id,
      url: updated.url,
      active: updated.active,
      events: updated.events,
    });
  } catch (e) {
    return handleError(e);
  }
}
