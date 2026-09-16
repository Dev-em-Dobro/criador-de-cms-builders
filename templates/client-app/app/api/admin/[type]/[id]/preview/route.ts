import { NextRequest } from "next/server";
import { requireSession } from "@/lib/core-runtime";
import { resolveTypeParam } from "@/lib/core-runtime";
import { createPreviewToken } from "@cms-core/core/auth";
import { jsonOk, jsonError, handleError } from "@/lib/http";

type Ctx = { params: Promise<{ type: string; id: string }> };

export async function POST(_req: NextRequest, ctx: Ctx) {
  try {
    await requireSession();
    const { type: param, id } = await ctx.params;
    if (!resolveTypeParam(param)) return jsonError(404, "Unknown content type");
    const token = await createPreviewToken(id);
    const path = `/preview/${param}/${id}?token=${token}`;
    // Prefer the marketing site (real design); fall back to the CMS's own
    // minimal preview page when SITE_URL is not configured.
    const site = process.env.SITE_URL?.replace(/\/$/, "");
    return jsonOk({ url: site ? `${site}${path}` : path });
  } catch (e) {
    return handleError(e);
  }
}
