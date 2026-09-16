import { NextRequest } from "next/server";
import { SEGMENT_TO_TYPE } from "@/lib/core-runtime";
import { getPublished } from "@/lib/core-runtime";
import { jsonOk, jsonError, readKeyValid, handleError } from "@/lib/http";

type Ctx = { params: Promise<{ type: string; slug: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    if (!readKeyValid(req)) return jsonError(401, "Invalid API key");
    const { type: segment, slug } = await ctx.params;
    const type = SEGMENT_TO_TYPE[segment];
    if (!type) return jsonError(404, "Unknown content type");

    const locale = new URL(req.url).searchParams.get("locale") ?? "en";
    const entry = await getPublished(type, slug, locale);
    // 404 for unpublished/deleted/missing — no draft leakage (SC-003).
    if (!entry) return jsonError(404, "Not found");
    return jsonOk(entry);
  } catch (e) {
    return handleError(e);
  }
}
