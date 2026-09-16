import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/core-runtime";
import { updateUser, resetMfa, deleteUser } from "@/lib/core-runtime";
import { writeAudit } from "@/lib/audit/log";
import { jsonOk, jsonError, clientMeta, handleError } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, ctx: Ctx) {
  try {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const body = await req.json();
    const patch: { role?: "admin" | "editor"; status?: "active" | "invited" | "disabled" } =
      {};
    if (body.role === "admin" || body.role === "editor") patch.role = body.role;
    if (
      body.status === "active" ||
      body.status === "invited" ||
      body.status === "disabled"
    )
      patch.status = body.status;
    if (patch.role === undefined && patch.status === undefined)
      return jsonError(422, "Nothing to update");

    const user = await updateUser(id, patch);
    await writeAudit({
      actorId: admin.sub,
      actorEmail: admin.email,
      action: patch.status === "disabled" ? "user.disabled" : "user.update",
      targetType: "user",
      targetId: id,
      metadata: patch,
    });
    return jsonOk({
      user: { id: user.id, email: user.email, role: user.role, status: user.status },
    });
  } catch (e) {
    return handleError(e);
  }
}

/**
 * Reset a user's second factor — for a lost or replaced phone.
 *
 * Deleting a verified factor signs the user out of every active session, so
 * the old factor stops working immediately rather than at the end of their
 * current session. They land in the bootstrap state and enrol again.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    if (body?.action !== "reset-mfa") {
      return jsonError(422, "Unsupported action");
    }

    await resetMfa(id);
    await writeAudit({
      actorId: admin.sub,
      actorEmail: admin.email,
      action: "user.mfa_reset",
      targetType: "user",
      targetId: id,
    });
    // Resetting the factor signs the user out of every active session.
    await writeAudit({
      actorId: admin.sub,
      actorEmail: admin.email,
      action: "auth.session_revoked",
      targetType: "user",
      targetId: id,
      metadata: { reason: "mfa_reset", ...clientMeta(req) },
    });
    return jsonOk({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}

/**
 * Delete a user outright. The service refuses to remove the last active
 * administrator (409). It deletes the Supabase `auth.users` row and then removes
 * the `profiles` row explicitly, so the physical delete works the same whether
 * content lives on Supabase (FK cascade already fired — the delete is a no-op) or
 * on Neon (no cross-database FK — the explicit delete prevents a silent orphan,
 * §13.4 / S5.4). Audit rows and authored content are kept with the actor nulled
 * and the email snapshot intact. Disabling (PUT status="disabled") is the
 * recommended, provider-agnostic v1 path and never depended on the FK.
 */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  try {
    const admin = await requireAdmin();
    const { id } = await ctx.params;

    await deleteUser(id);
    await writeAudit({
      actorId: admin.sub,
      actorEmail: admin.email,
      action: "user.deleted",
      targetType: "user",
      targetId: id,
      metadata: clientMeta(req),
    });
    return jsonOk({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
