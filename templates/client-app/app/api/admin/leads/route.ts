import { requireSession } from "@/lib/core-runtime";
import { listLeads } from "@/lib/leads/service";
import { jsonOk, handleError } from "@/lib/http";

/** GET /api/admin/leads — list contact-form submissions, newest first. */
export async function GET() {
  try {
    await requireSession();
    const items = await listLeads();
    return jsonOk({ items });
  } catch (e) {
    return handleError(e);
  }
}
