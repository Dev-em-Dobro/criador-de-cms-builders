import { redirect } from "next/navigation";
import { requireSession } from "@/lib/core-runtime";
import { AuthError } from "@cms-core/core/auth";
import AdminOnlyNotice from "@/components/AdminOnlyNotice";
import UsersManager from "@/components/UsersManager";

export default async function UsersPage() {
  // Admin screen. Only the SESSION is resolved here (sign-in, second factor,
  // disabled account) — the role is checked just below so the refusal can be
  // explained instead of bouncing the person to the dashboard in silence. The
  // real boundary stays in the API, which answers 403 on its own.
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

  if (session.role !== "admin") return <AdminOnlyNotice title="Users" />;

  return <UsersManager />;
}
