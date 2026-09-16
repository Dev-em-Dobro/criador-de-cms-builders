/**
 * Notice shown to someone who lands on an admin-only screen without the role.
 *
 * Why this exists instead of a plain redirect: the guard already sent them back
 * to the dashboard, which is safe but mute — whoever typed the URL or followed
 * a link pasted by a colleague ends up on the home screen unsure whether the
 * click failed, the screen moved, or they lack permission. Saying so answers it.
 *
 * This screen is NOT the security boundary: the API routes answer 403 on their
 * own (`requireAdmin`), and that is where access is actually refused. This is
 * only the explanation.
 */
export default function AdminOnlyNotice({ title }: { title: string }) {
  return (
    <div>
      <h1 className="text-2xl font-bold text-ink">{title}</h1>
      <p className="mt-4 rounded-lg border border-line-strong bg-paper p-4 text-sm text-ink">
        This area is restricted to administrators.
      </p>
    </div>
  );
}
