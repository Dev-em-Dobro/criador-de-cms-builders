import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/core-runtime";
import {
  updateLocale,
  setDefaultLocale,
  setLocaleEnabled,
  deleteLocale,
} from "@/lib/core-runtime";
import { jsonOk, jsonError, handleError } from "@/lib/http";

type Ctx = { params: Promise<{ code: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const admin = await requireAdmin();
    const { code } = await ctx.params;
    const body = await req.json();

    // Default and enabled are their own guarded operations.
    if (body.isDefault === true) {
      const r = await setDefaultLocale(code, admin.sub);
      if (!r.ok) return jsonError(422, r.error);
      return jsonOk(r.value);
    }
    if (typeof body.enabled === "boolean") {
      const r = await setLocaleEnabled(code, body.enabled, admin.sub);
      if (!r.ok) return jsonError(422, r.error);
      return jsonOk(r.value);
    }
    const r = await updateLocale(
      code,
      { label: body.label, sortOrder: body.sortOrder },
      admin.sub,
    );
    if (!r.ok) return jsonError(422, r.error);
    return jsonOk(r.value);
  } catch (e) {
    return handleError(e);
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const admin = await requireAdmin();
    const { code } = await ctx.params;
    const r = await deleteLocale(code, admin.sub);
    if (!r.ok) return jsonError(422, r.error);
    return jsonOk({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
