import { NextRequest } from "next/server";
import { requireSession } from "@/lib/core-runtime";
import { resolveTypeParam, defForType } from "@/lib/core-runtime";
import { listEntries, createEntry } from "@/lib/core-runtime";
import { jsonOk, jsonError, jsonValidationError, handleError } from "@/lib/http";

type Ctx = { params: Promise<{ type: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    await requireSession();
    const { type: param } = await ctx.params;
    const type = resolveTypeParam(param);
    if (!type) return jsonError(404, "Unknown content type");

    const sp = new URL(req.url).searchParams;
    const statusRaw = sp.get("status");
    const status =
      statusRaw === "draft" || statusRaw === "published" || statusRaw === "archived"
        ? statusRaw
        : undefined;

    const entries = await listEntries(type, {
      status,
      limit: Number(sp.get("limit") ?? 50),
      offset: Number(sp.get("offset") ?? 0),
    });
    const def = defForType(type);
    const items = entries.map((e) => ({
      id: e.id,
      slug: e.slug,
      locale: e.locale,
      status: e.status,
      updatedAt: e.updatedAt,
      currentVersionId: e.currentVersionId,
      ...def.toListItem(e.data),
    }));
    return jsonOk({ items });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const session = await requireSession();
    const { type: param } = await ctx.params;
    const type = resolveTypeParam(param);
    if (!type) return jsonError(404, "Unknown content type");

    const body = await req.json();
    const result = await createEntry(type, {
      data: body.data ?? body,
      slug: body.slug,
      locale: body.locale,
      translationGroupId: body.translationGroupId,
      actorId: session.sub,
    });
    if (!result.ok) return jsonValidationError(result.errors);
    return jsonOk(result.entry, 201);
  } catch (e) {
    return handleError(e);
  }
}
