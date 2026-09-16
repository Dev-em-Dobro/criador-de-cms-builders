import { NextRequest } from "next/server";
import { requireSession } from "@/lib/core-runtime";
import { resolveTypeParam } from "@/lib/core-runtime";
import { reorderEntries, dispatchRevalidation } from "@/lib/core-runtime";
import { jsonOk, jsonError, handleError } from "@/lib/http";

type Ctx = { params: Promise<{ type: string }> };

/**
 * Persist a drag-and-drop ordering for a collection. Body: `{ order: string[] }`
 * — translationGroupIds in the desired order. Static `reorder` segment sits
 * beside `[id]`, so Next routes /api/admin/people/reorder here, not to [id].
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const session = await requireSession();
    const { type: param } = await ctx.params;
    const type = resolveTypeParam(param);
    if (!type) return jsonError(404, "Unknown content type");

    const body = await req.json().catch(() => ({}));
    const order = body.order;
    if (
      !Array.isArray(order) ||
      !order.every((id) => typeof id === "string")
    ) {
      return jsonError(400, "Expected { order: string[] }");
    }

    await reorderEntries(type, order, session.sub);

    /**
     * Avisa os consumidores de que a coleção mudou.
     *
     * `reorderEntries` do core grava a nova ordem e a auditoria, mas NÃO chama
     * `dispatchRevalidation` — só publish/unpublish/delete fazem isso. Sem este
     * disparo, arrastar um item no admin muda o banco e a read API na hora, e o
     * site consumidor continua servindo a ordem antiga em cache até o próximo
     * publish (ou até o revalidate por tempo).
     *
     * `slug`/`locale` vão como "*" porque a reordenação é da coleção inteira,
     * não de uma entrada; o consumidor invalida o cache do tipo. O `event`
     * reaproveita "entry.published" por ser o único valor que o contrato do
     * core admite hoje — um "entry.reordered" próprio exigiria estender
     * `RevalidationEvent` no core.
     */
    await dispatchRevalidation({
      event: "entry.published",
      type,
      slug: "*",
      locale: "*",
      at: new Date().toISOString(),
    });

    return jsonOk({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
