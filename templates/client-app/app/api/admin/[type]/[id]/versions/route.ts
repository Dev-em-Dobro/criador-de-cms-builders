import { NextRequest } from "next/server";
import { requireSession } from "@/lib/core-runtime";
import { resolveTypeParam } from "@/lib/core-runtime";
import { listVersions } from "@/lib/core-runtime";
import { jsonOk, jsonError, handleError } from "@/lib/http";

type Ctx = { params: Promise<{ type: string; id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    await requireSession();
    const { type: param, id } = await ctx.params;
    if (!resolveTypeParam(param)) return jsonError(404, "Unknown content type");
    const versions = await listVersions(id);
    return jsonOk({ versions });
  } catch (e) {
    return handleError(e);
  }
}
