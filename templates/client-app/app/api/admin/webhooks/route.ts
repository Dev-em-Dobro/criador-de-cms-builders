import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { webhookEndpoints } from "@/db/schema";
import { requireAdmin } from "@/lib/core-runtime";
import { writeAudit } from "@/lib/audit/log";
import { jsonOk, jsonError, handleError } from "@/lib/http";

export async function GET() {
  try {
    await requireAdmin();
    const items = await db
      .select({
        id: webhookEndpoints.id,
        url: webhookEndpoints.url,
        active: webhookEndpoints.active,
        events: webhookEndpoints.events,
        createdAt: webhookEndpoints.createdAt,
      })
      .from(webhookEndpoints)
      .orderBy(desc(webhookEndpoints.createdAt));
    return jsonOk({ items });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin();
    const body = await req.json();
    if (typeof body.url !== "string" || !body.url.startsWith("http"))
      return jsonError(422, "Valid url required");
    const secret = typeof body.secret === "string" ? body.secret : randomUUID();
    const events = Array.isArray(body.events) ? body.events : [];

    const [endpoint] = await db
      .insert(webhookEndpoints)
      .values({ url: body.url, secret, events, active: true })
      .returning();

    await writeAudit({
      actorId: admin.sub,
      action: "webhook.create",
      targetType: "webhook",
      targetId: endpoint.id,
      metadata: { url: body.url },
    });
    // Return the secret once so the site can be configured with it.
    return jsonOk({ id: endpoint.id, url: endpoint.url, secret, events }, 201);
  } catch (e) {
    return handleError(e);
  }
}
