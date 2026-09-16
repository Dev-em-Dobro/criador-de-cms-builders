/**
 * Best-effort forward of a captured lead to a downstream consumer.
 *
 * Decoupled from the database write: the lead is already persisted before this
 * runs, and any failure here is logged and swallowed so a slow/broken webhook
 * never loses (or blocks) a lead. No-op when `LEAD_WEBHOOK_URL` is unset.
 */
export async function dispatchLeadWebhook(
  payload: Record<string, unknown>,
): Promise<void> {
  const url = process.env.LEAD_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.error("[leads] webhook dispatch failed:", e);
  }
}
