import { NextRequest } from "next/server";
import { requireSession } from "@/lib/core-runtime";
import { deleteLead } from "@/lib/leads/service";
import { writeAudit } from "@/lib/audit/log";
import { jsonOk, clientMeta, handleError } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

/**
 * DELETE /api/admin/leads/[id] — remove a contact-form submission for good.
 * Any authenticated CMS user may clear submissions; the delete is audited.
 */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  try {
    const session = await requireSession();
    const { id } = await ctx.params;

    await deleteLead(id);
    await writeAudit({
      actorId: session.sub,
      actorEmail: session.email,
      action: "lead.deleted",
      targetType: "lead",
      targetId: id,
      metadata: clientMeta(req),
    });
    return jsonOk({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
