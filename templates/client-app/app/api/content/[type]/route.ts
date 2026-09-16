import { NextRequest } from "next/server";
import { SEGMENT_TO_TYPE, facetNamesFor } from "@/lib/core-runtime";
import { listPublished, listPublishedCases } from "@/lib/core-runtime";
import { jsonOk, jsonError, readKeyValid, handleError } from "@/lib/http";

type Ctx = { params: Promise<{ type: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    if (!readKeyValid(req)) return jsonError(401, "Invalid API key");
    const { type: segment } = await ctx.params;
    const type = SEGMENT_TO_TYPE[segment];
    if (!type) return jsonError(404, "Unknown content type");

    const sp = new URL(req.url).searchParams;
    const locale = sp.get("locale") ?? "en";
    const page = Number(sp.get("page") ?? 1);
    const pageSize = Number(sp.get("pageSize") ?? 20);
    const tags = sp.getAll("tag");

    // Facet-filtered library: parsing dirigido por `def.facets[].name` do config
    // (S2.5 AC9/T5.3), não por colunas hardcoded. O `case` continua com os 4
    // facets industry/service/region/outcome, mas agora derivados do config —
    // uma nova coleção com facets recebe o parsing sem código específico.
    const facetNames = facetNamesFor(type);
    if (facetNames.length > 0) {
      const facetParams = Object.fromEntries(
        facetNames.map((name) => [name, sp.getAll(name)]),
      );
      const result = await listPublishedCases({
        locale,
        page,
        pageSize,
        tags,
        ...facetParams,
      });
      return jsonOk(result);
    }

    const result = await listPublished(type, { locale, page, pageSize, tags });
    return jsonOk(result);
  } catch (e) {
    return handleError(e);
  }
}
