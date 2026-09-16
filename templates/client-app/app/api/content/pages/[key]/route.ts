import { NextRequest } from "next/server";
import { SINGLETON_PAGES } from "@/lib/core-runtime";
import { getPublished } from "@/lib/core-runtime";
import { jsonOk, jsonError, readKeyValid, handleError } from "@/lib/http";

type Ctx = { params: Promise<{ key: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    if (!readKeyValid(req)) return jsonError(401, "Invalid API key");
    const { key } = await ctx.params;
    const page = SINGLETON_PAGES[key];
    if (!page) return jsonError(404, "Unknown page");

    const locale = new URL(req.url).searchParams.get("locale") ?? "en";
    const entry = await getPublished(page.type, page.slug, locale);
    if (!entry) return jsonError(404, "Not found");
    return jsonOk({ key, ...entry });
  } catch (e) {
    return handleError(e);
  }
}
