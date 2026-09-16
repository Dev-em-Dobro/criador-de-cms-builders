import { NextRequest } from "next/server";
import { resolveTypeParam } from "@/lib/core-runtime";
import { getEntry } from "@/lib/core-runtime";
import { serializeEntry } from "@/lib/core-runtime";
import { verifyPreviewToken } from "@cms-core/core/auth";
import { jsonOk, jsonError, handleError } from "@/lib/http";

type Ctx = { params: Promise<{ type: string; id: string }> };

/**
 * Draft-aware read endpoint for the marketing site's preview route (D5).
 *
 * Unlike the published read API, this returns an entry regardless of status —
 * but only to a caller holding a valid, short-lived preview token bound to that
 * exact entry id. The site never sees drafts without a token minted by the CMS.
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    const { type: param, id } = await ctx.params;
    const type = resolveTypeParam(param);
    if (!type) return jsonError(404, "Unknown content type");

    const token = new URL(req.url).searchParams.get("token");
    if (!token || !(await verifyPreviewToken(token, id))) {
      return jsonError(401, "Invalid or missing preview token");
    }

    // Draft-aware read (excludes soft-deleted). Published or not, the token
    // gates access to this one entry.
    const entry = await getEntry(type, id);
    if (!entry) return jsonError(404, "Not found");

    return jsonOk(await serializeEntry(entry, entry.data));
  } catch (e) {
    return handleError(e);
  }
}
