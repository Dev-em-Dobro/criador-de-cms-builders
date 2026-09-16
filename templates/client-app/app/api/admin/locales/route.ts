import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/core-runtime";
import { getLocales, createLocale } from "@/lib/core-runtime";
import { jsonOk, jsonError, handleError } from "@/lib/http";

export async function GET() {
  try {
    await requireAdmin();
    return jsonOk({ locales: await getLocales() });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin();
    const body = await req.json();
    if (typeof body.code !== "string" || typeof body.label !== "string")
      return jsonError(422, "code and label are required");
    const result = await createLocale(
      { code: body.code, label: body.label },
      admin.sub,
    );
    if (!result.ok) return jsonError(422, result.error);
    return jsonOk(result.value, 201);
  } catch (e) {
    return handleError(e);
  }
}
