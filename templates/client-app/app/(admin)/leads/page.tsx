import { redirect } from "next/navigation";
import { requireSession } from "@/lib/core-runtime";
import { AuthError } from "@cms-core/core/auth";
import ContactsManager from "@/components/ContactsManager";

export default async function ContactsPage() {
  // UX gate only; the API enforces auth on its own and is the real boundary.
  try {
    await requireSession();
  } catch (e) {
    if (e instanceof AuthError) {
      if (e.next === "enrol") redirect("/auth/enrol");
      if (e.next === "mfa") redirect("/login?step=mfa");
      redirect("/login");
    }
    throw e;
  }
  return <ContactsManager />;
}
