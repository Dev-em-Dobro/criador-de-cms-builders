import { NextRequest } from "next/server";
import { requireSession } from "@/lib/core-runtime";
import { resolveTypeParam } from "@/lib/core-runtime";
import { addTranslation } from "@/lib/core-runtime";
import { jsonOk, jsonError, jsonValidationError, handleError } from "@/lib/http";

type Ctx = { params: Promise<{ type: string; id: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const session = await requireSession();
    const { type: param, id } = await ctx.params;
    const type = resolveTypeParam(param);
    if (!type) return jsonError(404, "Unknown content type");
    const { locale } = await req.json();
    if (typeof locale !== "string" || !locale)
      return jsonError(422, "locale is required");
    const result = await addTranslation(type, id, locale, session.sub);
    if (!result.ok) return jsonValidationError(result.errors);
    return jsonOk(result.entry, 201);
  } catch (e) {
    return handleError(e);
  }
}
