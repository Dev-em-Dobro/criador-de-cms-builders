import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { leads, type Lead } from "@/db/schema";
import { NotFoundError } from "@/lib/errors";

/** All contact-form submissions, newest first. */
export async function listLeads(): Promise<Lead[]> {
  return db.select().from(leads).orderBy(desc(leads.createdAt));
}

/** Delete one submission. Throws NotFoundError when the id does not exist. */
export async function deleteLead(id: string): Promise<void> {
  const [row] = await db
    .delete(leads)
    .where(eq(leads.id, id))
    .returning({ id: leads.id });
  if (!row) throw new NotFoundError("Contact not found");
}
