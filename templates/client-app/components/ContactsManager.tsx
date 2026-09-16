"use client";

import { Fragment, useEffect, useState } from "react";
import {
  StatusMessage,
  Skeleton,
  LoadingOverlay,
  buttonSecondary,
  buttonDanger,
} from "@cms-core/core/ui";
import { useConfirm } from "./ui/useConfirm";

interface Contact {
  id: string;
  createdAt: string;
  name: string;
  email: string;
  organisation: string | null;
  message: string;
  source: string | null;
  referer: string | null;
  userAgent: string | null;
}

export default function ContactsManager() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [working, setWorking] = useState(false);
  const [confirm, confirmDialog] = useConfirm();

  function load() {
    setLoading(true);
    fetch("/api/admin/leads")
      .then((r) => r.json())
      .then((b) => setContacts(b.items ?? []))
      .catch(() => setError("Could not load contacts."))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function remove(c: Contact) {
    const ok = await confirm({
      title: `Delete the message from ${c.name}?`,
      description:
        "This contact submission is removed permanently. This cannot be undone.",
      confirmLabel: "Delete contact",
      destructive: true,
    });
    if (!ok) return;
    setError("");
    setNotice("");
    setWorking(true);
    try {
      const res = await fetch(`/api/admin/leads/${c.id}`, { method: "DELETE" });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) return setError(b.error ?? "Could not delete the contact.");
      setNotice(`Message from ${c.name} was deleted.`);
      if (expanded === c.id) setExpanded(null);
      setContacts((prev) => prev.filter((x) => x.id !== c.id));
    } catch {
      setError("Could not reach the server.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div>
      <div className="mb-5 flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-bold text-ink">Contacts</h1>
        {!loading && (
          <p className="text-sm text-muted">
            {contacts.length} {contacts.length === 1 ? "message" : "messages"}
          </p>
        )}
      </div>
      <p className="mb-6 max-w-2xl text-sm text-muted">
        Submissions from the contact form on the marketing site. Open a row to
        read the full message, or delete submissions you have dealt with.
      </p>

      {error && (
        <StatusMessage tone="error" className="mb-4">
          {error}
        </StatusMessage>
      )}
      {notice && (
        <StatusMessage tone="success" className="mb-4">
          {notice}
        </StatusMessage>
      )}

      {loading ? (
        <Skeleton rows={4} />
      ) : contacts.length === 0 ? (
        <p className="rounded-lg border border-line-strong p-6 text-sm text-muted">
          No contact submissions yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line-strong">
          <table className="w-full min-w-[40rem] text-sm">
            <caption className="sr-only">
              Contact-form submissions with sender, email, date, and actions to
              view or delete each message
            </caption>
            <thead className="bg-paper text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th scope="col" className="px-4 py-2 font-semibold">Name</th>
                <th scope="col" className="px-4 py-2 font-semibold">Email</th>
                <th scope="col" className="px-4 py-2 font-semibold">Organisation</th>
                <th scope="col" className="px-4 py-2 font-semibold">Received</th>
                <th scope="col" className="px-4 py-2 font-semibold">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => {
                const open = expanded === c.id;
                return (
                  <Fragment key={c.id}>
                    <tr className="border-t border-line align-top">
                      <th
                        scope="row"
                        className="px-4 py-2 text-left font-medium text-ink"
                      >
                        {c.name}
                      </th>
                      <td className="px-4 py-2">
                        <a
                          href={`mailto:${c.email}`}
                          className="text-brand-dark underline decoration-line-strong underline-offset-2 hover:decoration-brand-dark"
                        >
                          {c.email}
                        </a>
                      </td>
                      <td className="px-4 py-2 text-muted">
                        {c.organisation || "—"}
                      </td>
                      <td className="px-4 py-2 text-muted">
                        <time dateTime={c.createdAt}>
                          {new Date(c.createdAt).toLocaleString()}
                        </time>
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            aria-expanded={open}
                            onClick={() => setExpanded(open ? null : c.id)}
                            className={buttonSecondary}
                          >
                            {open ? "Hide" : "View"}
                          </button>
                          <button
                            type="button"
                            onClick={() => remove(c)}
                            className={buttonDanger}
                            aria-label={`Delete message from ${c.name}`}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                    {open && (
                      <tr className="border-t border-line bg-paper">
                        <td colSpan={5} className="px-4 py-4">
                          <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[8rem_1fr]">
                            <dt className="font-medium text-muted">Message</dt>
                            <dd className="whitespace-pre-wrap break-words text-ink">
                              {c.message}
                            </dd>
                            <dt className="font-medium text-muted">Source</dt>
                            <dd className="break-words text-ink">
                              {c.source || "—"}
                            </dd>
                            <dt className="font-medium text-muted">Referer</dt>
                            <dd className="break-all text-ink">
                              {c.referer || "—"}
                            </dd>
                            <dt className="font-medium text-muted">User agent</dt>
                            <dd className="break-all text-ink">
                              {c.userAgent || "—"}
                            </dd>
                          </dl>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {confirmDialog}
      <LoadingOverlay show={working} message="Deleting…" />
    </div>
  );
}
