import { redirect } from "next/navigation";
import { requireSession } from "@/lib/core-runtime";
import { AuthError } from "@cms-core/core/auth";
import AdminOnlyNotice from "@/components/AdminOnlyNotice";
import LanguagesManager from "@/components/LanguagesManager";

export default async function LanguagesPage() {
  // Admin screen — same rule as `users/page.tsx`: session here, role just
  // below, and the actual refusal lives in the API (403).
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

  if (session.role !== "admin") return <AdminOnlyNotice title="Languages" />;

  return <LanguagesManager />;
}
