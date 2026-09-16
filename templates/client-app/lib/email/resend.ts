import { Resend } from "resend";
import clientConfig from "@/client.config";

// Remetente derivado de config.providers.email (S2.6, AC6): fromName + senderDomain.
// Ordem de precedência: EMAIL_FROM env (override de deploy) > config-derived >
// fallback de sandbox do Resend (`onboarding@resend.dev`, só p/ testes locais sem
// env nem senderDomain — o literal hardcoded do sender foi removido).
const RESEND_SANDBOX_FROM = "onboarding@resend.dev";
const { fromName, senderDomain } = clientConfig.providers.email;
const senderName = fromName ?? "CMS";
const configFrom = senderDomain
  ? `${senderName} <noreply@${senderDomain}>`
  : `${senderName} <${RESEND_SANDBOX_FROM}>`;

/** Best-effort transactional email. No-ops (with a warning) if unconfigured. */
export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn("[email] RESEND_API_KEY not set — skipping send to", opts.to);
    return;
  }
  const from = process.env.EMAIL_FROM ?? configFrom;
  try {
    const resend = new Resend(key);
    await resend.emails.send({
      from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
    });
  } catch (e) {
    console.error("[email] send failed:", e);
  }
}
