import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/core-runtime";
import { listUsers, inviteUser } from "@/lib/core-runtime";
import { writeAudit } from "@/lib/audit/log";
import { jsonOk, jsonError, handleError } from "@/lib/http";

export async function GET() {
  try {
    await requireAdmin(); // editors -> 403 (FR-014)
    const items = await listUsers();
    return jsonOk({ items });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin();
    const body = await req.json();
    const { email, role } = body ?? {};

    if (typeof email !== "string" || !email.includes("@"))
      return jsonError(422, "Valid email required");
    if (role !== "admin" && role !== "editor")
      return jsonError(422, "role must be admin or editor");

    /**
     * No password field, deliberately: the invitee sets their own via the
     * emailed link, so an administrator never handles anyone else's
     * credentials. The invitation email is sent by Supabase — which is why
     * custom SMTP must be configured, the built-in sender allows 2 per hour.
     *
     * No MFA secret comes back either. Supabase has no API to enrol a factor
     * on another user's behalf; the invitee enrols their own on first sign-in.
     */
    const user = await inviteUser({ email, role });

    await writeAudit({
      actorId: admin.sub,
      actorEmail: admin.email,
      action: "user.invited",
      targetType: "user",
      targetId: user.id,
      metadata: { email: user.email, role: user.role },
    });

    return jsonOk(
      { user: { id: user.id, email: user.email, role: user.role } },
      201,
    );
  } catch (e) {
    return handleError(e);
  }
}
