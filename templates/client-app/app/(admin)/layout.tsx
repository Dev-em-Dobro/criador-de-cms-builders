import { redirect } from "next/navigation";
import { requireSession } from "@/lib/core-runtime";
import { AuthError } from "@cms-core/core/auth";
import { AdminNav } from "@cms-core/core/ui";
import clientConfig from "@/client.config";
import { NAV } from "@/lib/admin/nav.generated";

// Rótulo de marca da nav: derivado de branding.adminTitle (S2.6, gen-theme/T3.4).
// O array NAV é GERADO de client.config.ts (S2.6, gen-nav) — o hardcode saiu daqui.
const ADMIN_TITLE = clientConfig.branding.adminTitle;

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  /**
   * This gate is convenience, not enforcement. Layouts do not re-render on
   * navigation under Partial Rendering, and a layout check never extends to
   * Server Actions defined in child pages. Every route handler calls its own
   * guard — that is where the security boundary actually is.
   */
  let session;
  try {
    session = await requireSession();
  } catch (e) {
    if (e instanceof AuthError) {
      if (e.next === "enrol") redirect("/auth/enrol");
      if (e.next === "mfa") redirect("/login?step=mfa");
      redirect("/login");
    }
    throw e;
  }

  const items = NAV.filter((n) => !n.adminOnly || session.role === "admin");

  return (
    <div className="min-h-screen md:flex">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-ink focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
      >
        Skip to main content
      </a>
      <AdminNav items={items} email={session.email} adminTitle={ADMIN_TITLE} />
      <main id="main" className="min-w-0 flex-1 p-4 sm:p-6 md:p-8">
        {children}
      </main>
    </div>
  );
}
