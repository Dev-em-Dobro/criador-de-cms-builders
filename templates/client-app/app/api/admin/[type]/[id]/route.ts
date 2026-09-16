import { NextRequest } from "next/server";
import { requireSession } from "@/lib/core-runtime";
import { resolveTypeParam } from "@/lib/core-runtime";
import { getEntry, updateEntry, deleteEntry } from "@/lib/core-runtime";
import { jsonOk, jsonError, jsonValidationError, handleError } from "@/lib/http";

type Ctx = { params: Promise<{ type: string; id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    await requireSession();
    const { type: param, id } = await ctx.params;
    const type = resolveTypeParam(param);
    if (!type) return jsonError(404, "Unknown content type");
    const entry = await getEntry(type, id);
    if (!entry) return jsonError(404, "Entry not found");
    return jsonOk(entry);
  } catch (e) {
    return handleError(e);
  }
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  try {
    const session = await requireSession();
    const { type: param, id } = await ctx.params;
    const type = resolveTypeParam(param);
    if (!type) return jsonError(404, "Unknown content type");

    const body = await req.json();
    const result = await updateEntry(type, id, {
      data: body.data ?? body,
      expectedVersionId: body.expectedVersionId,
      actorId: session.sub,
    });
    if (!result.ok) return jsonValidationError(result.errors);
    return jsonOk(result.entry);
  } catch (e) {
    return handleError(e);
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  try {
    const session = await requireSession();
    const { type: param, id } = await ctx.params;
    const type = resolveTypeParam(param);
    if (!type) return jsonError(404, "Unknown content type");
    await deleteEntry(type, id, session.sub);
    return jsonOk({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
