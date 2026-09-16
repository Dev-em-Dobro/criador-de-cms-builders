import { NextRequest } from "next/server";
import { requireSession } from "@/lib/core-runtime";
import { resolveTypeParam } from "@/lib/core-runtime";
import { restoreVersion } from "@/lib/core-runtime";
import { jsonOk, jsonError, handleError } from "@/lib/http";

type Ctx = { params: Promise<{ type: string; id: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const session = await requireSession();
    const { type: param, id } = await ctx.params;
    const type = resolveTypeParam(param);
    if (!type) return jsonError(404, "Unknown content type");
    const { versionId } = await req.json();
    if (typeof versionId !== "string")
      return jsonError(422, "versionId is required");
    const entry = await restoreVersion(type, id, versionId, session.sub);
    return jsonOk(entry);
  } catch (e) {
    return handleError(e);
  }
}
