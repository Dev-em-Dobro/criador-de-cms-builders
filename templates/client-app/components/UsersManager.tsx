"use client";

import { useEffect, useState } from "react";
import {
  StatusMessage,
  Skeleton,
  LoadingOverlay,
  buttonPrimary,
  buttonSecondary,
  buttonDanger,
  input,
  select,
} from "@cms-core/core/ui";
import { useConfirm } from "./ui/useConfirm";

/** Audit entries shown per page. */
const AUDIT_PAGE_SIZE = 20;

interface UserRow {
  id: string;
  email: string;
  role: "admin" | "editor";
  status: "active" | "invited" | "disabled";
  lastLoginAt: string | null;
}
interface AuditRow {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  actorId: string | null;
  actorEmail: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export default function UsersManager() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [expandedAudit, setExpandedAudit] = useState<string | null>(null);
  const [auditPage, setAuditPage] = useState(0);
  const [auditHasMore, setAuditHasMore] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "editor">("editor");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [working, setWorking] = useState(false); // a row action in flight
  const [confirm, confirmDialog] = useConfirm();

  /**
   * One page of audit. Asks for one row beyond the page: its presence is what
   * proves a next page exists, without a count query over an append-only log
   * that only grows.
   */
  function loadAudit(page: number) {
    setAuditLoading(true);
    setAuditPage(page);
    return fetch(
      `/api/admin/audit?limit=${AUDIT_PAGE_SIZE + 1}&offset=${page * AUDIT_PAGE_SIZE}`,
    )
      .then((r) => r.json())
      .then((b) => {
        const items: AuditRow[] = b.items ?? [];
        setAuditHasMore(items.length > AUDIT_PAGE_SIZE);
        setAudit(items.slice(0, AUDIT_PAGE_SIZE));
      })
      .catch(() => {})
      .finally(() => setAuditLoading(false));
  }

  function load() {
    setLoading(true);
    Promise.all([
      fetch("/api/admin/users")
        .then((r) => r.json())
        .then((b) => setUsers(b.items ?? []))
        .catch(() => setError("Could not load users.")),
      loadAudit(0),
    ]).finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      const b = await res.json();
      if (!res.ok) return setError(b.error ?? "Could not invite the user.");
      setNotice(`Invitation sent to ${email} as ${role}.`);
      setEmail("");
      load();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  async function resetMfa(user: UserRow) {
    const ok = await confirm({
      title: `Reset the second factor for ${user.email}?`,
      description:
        "Their current authenticator stops working immediately and they are signed out everywhere. They will set up a new one on their next sign-in.",
      confirmLabel: "Reset second factor",
      destructive: true,
    });
    if (!ok) return;
    setError("");
    setNotice("");
    setWorking(true);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "reset-mfa" }),
      });
      const b = await res.json();
      if (!res.ok) return setError(b.error ?? "Could not reset the second factor.");
      setNotice(`${user.email} will set up a new authenticator on next sign-in.`);
      load();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setWorking(false);
    }
  }

  async function removeUser(user: UserRow) {
    const ok = await confirm({
      title: `Delete ${user.email}?`,
      description:
        "Their account and sign-in are removed permanently. Anything they authored and the audit trail are kept, with the author left blank. This cannot be undone.",
      confirmLabel: "Delete user",
      destructive: true,
    });
    if (!ok) return;
    setError("");
    setNotice("");
    setWorking(true);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "DELETE",
      });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) return setError(b.error ?? "Could not delete the user.");
      setNotice(`${user.email} was deleted.`);
      load();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setWorking(false);
    }
  }

  async function patch(id: string, body: Record<string, string>) {
    setError("");
    setNotice("");
    setWorking(true);
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const b = await res.json();
      if (!res.ok) return setError(b.error ?? "Update failed.");
      load();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setWorking(false);
    }
  }

  // Privilege and access changes are confirmed — a stray scroll over a <select>
  // must not silently promote someone to admin or lock them out.
  async function changeRole(user: UserRow, next: string) {
    if (next === user.role) return;
    const ok = await confirm({
      title: `Change ${user.email} to ${next}?`,
      description:
        next === "admin"
          ? "Admins can manage users, change roles, and view the full audit log."
          : "Editors lose access to user management and the audit log.",
      confirmLabel: `Make ${next}`,
      destructive: next === "admin",
    });
    if (!ok) return;
    setNotice(`${user.email} is now ${next}.`);
    patch(user.id, { role: next });
  }

  async function changeStatus(user: UserRow, next: string) {
    if (next === user.status) return;
    if (next === "disabled") {
      const ok = await confirm({
        title: `Disable ${user.email}?`,
        description:
          "They will be signed out and blocked from signing in until re-enabled.",
        confirmLabel: "Disable account",
        destructive: true,
      });
      if (!ok) return;
    }
    setNotice(`${user.email} is now ${next}.`);
    patch(user.id, { status: next });
  }

  return (
    <div>
      <h1 className="mb-5 text-2xl font-bold text-ink">Users &amp; audit</h1>

      <form
        onSubmit={invite}
        className="mb-6 max-w-3xl rounded-lg border border-line-strong p-5"
      >
        <h2 className="text-sm font-semibold text-ink">Invite user</h2>
        {/* Enrolment is now self-service, and there is no password field: you
            never handle someone else's credentials, and there is no secret to
            pass along out of band. */}
        <p className="mt-1 text-sm text-muted">
          They receive an email invitation, set their own password, and set up
          their own authenticator app on first sign-in. Nothing here needs to be
          sent to them separately.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="new-email" className="text-sm font-medium text-ink">
              Email
            </label>
            <input
              id="new-email"
              className={input}
              type="email"
              autoComplete="off"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="new-role" className="text-sm font-medium text-ink">
              Role
            </label>
            <select
              id="new-role"
              className={`${select} w-full`}
              value={role}
              onChange={(e) => setRole(e.target.value as "admin" | "editor")}
            >
              <option value="editor">Editor</option>
              <option value="admin">Admin</option>
            </select>
          </div>

        </div>

        <div className="mt-5 flex justify-end border-t border-line pt-4">
          <button disabled={busy} aria-busy={busy} className={buttonPrimary}>
            {busy ? "Sending…" : "Send invitation"}
          </button>
        </div>
      </form>

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

      <h2 className="mb-2 text-sm font-semibold text-ink">Users</h2>
      {loading ? (
        <Skeleton rows={3} className="mb-8" />
      ) : (
        <div className="mb-8 overflow-x-auto rounded-lg border border-line-strong">
          <table className="w-full min-w-[36rem] text-sm">
            <caption className="sr-only">
              CMS users with their role, account status, second-factor actions,
              and account deletion
            </caption>
            <thead className="bg-paper text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th scope="col" className="px-4 py-2 font-semibold">Email</th>
                <th scope="col" className="px-4 py-2 font-semibold">Role</th>
                <th scope="col" className="px-4 py-2 font-semibold">Status</th>
                <th scope="col" className="px-4 py-2 font-semibold">Second factor</th>
                <th scope="col" className="px-4 py-2 font-semibold">
                  <span className="sr-only">Delete</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-line">
                  <th scope="row" className="px-4 py-2 text-left font-medium text-ink">
                    {u.email}
                  </th>
                  <td className="px-4 py-2">
                    <select
                      value={u.role}
                      onChange={(e) => changeRole(u, e.target.value)}
                      className={select}
                      aria-label={`Role for ${u.email}`}
                    >
                      <option value="editor">Editor</option>
                      <option value="admin">Admin</option>
                    </select>
                  </td>
                  <td className="px-4 py-2">
                    <select
                      value={u.status}
                      onChange={(e) => changeStatus(u, e.target.value)}
                      className={select}
                      aria-label={`Status for ${u.email}`}
                    >
                      <option value="active">Active</option>
                      <option value="invited">Invited</option>
                      <option value="disabled">Disabled</option>
                    </select>
                  </td>
                  <td className="px-4 py-2">
                    {/* Enrolment state is not mirrored locally — it lives in
                        Supabase, and a cached copy here would silently drift
                        out of date. What an admin can actually do is reset it. */}
                    <button
                      type="button"
                      onClick={() => resetMfa(u)}
                      className={buttonDanger}
                    >
                      Reset
                    </button>
                  </td>
                  <td className="px-4 py-2 text-right">
                    {/* Deletion is guarded server-side against removing the last
                        active administrator; the button stays enabled and the
                        409 surfaces as an error message rather than being
                        second-guessed in the UI. */}
                    <button
                      type="button"
                      onClick={() => removeUser(u)}
                      className={buttonDanger}
                      aria-label={`Delete ${u.email}`}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="mb-2 text-sm font-semibold text-ink">Recent audit</h2>
      {loading || auditLoading ? (
        <Skeleton rows={3} />
      ) : audit.length === 0 ? (
        <p className="text-sm text-muted">
          {auditPage === 0 ? "No audit entries yet." : "No entries on this page."}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-line text-sm" aria-live="polite">
          {audit.map((a) => {
            const open = expandedAudit === a.id;
            return (
              <li key={a.id} className="py-2">
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setExpandedAudit(open ? null : a.id)}
                  className="flex w-full flex-wrap items-center gap-x-3 gap-y-0.5 text-left transition-colors duration-150 hover:text-ink"
                >
                  <time
                    dateTime={a.createdAt}
                    className="w-40 shrink-0 text-xs text-muted"
                  >
                    {new Date(a.createdAt).toLocaleString()}
                  </time>
                  <span className="font-medium text-ink">{a.action}</span>
                  <span className="text-muted">
                    {a.targetType} {a.targetId?.slice(0, 8)}
                  </span>
                  <span className="ml-auto text-xs text-muted">
                    by {a.actorEmail ?? "system"}
                  </span>
                  <span aria-hidden="true" className="text-xs text-muted">
                    {open ? "▲" : "▼"}
                  </span>
                </button>

                {open && (
                  <dl className="mt-2 grid grid-cols-[6rem_1fr] gap-x-4 gap-y-1 rounded border border-line-strong bg-paper p-3 text-xs">
                    <dt className="text-muted">When</dt>
                    <dd className="text-ink">
                      {new Date(a.createdAt).toLocaleString()}
                    </dd>
                    <dt className="text-muted">Action</dt>
                    <dd className="font-medium text-ink">{a.action}</dd>
                    <dt className="text-muted">Actor</dt>
                    <dd className="break-all text-ink">
                      {a.actorEmail ?? "system"}
                      {a.actorId ? ` · ${a.actorId}` : ""}
                    </dd>
                    <dt className="text-muted">Target</dt>
                    <dd className="break-all text-ink">
                      {a.targetType ?? "—"}
                      {a.targetId ? ` · ${a.targetId}` : ""}
                    </dd>
                    <dt className="text-muted">Details</dt>
                    <dd className="text-ink">
                      {a.metadata && Object.keys(a.metadata).length > 0 ? (
                        <pre className="whitespace-pre-wrap break-all font-mono text-xs">
                          {JSON.stringify(a.metadata, null, 2)}
                        </pre>
                      ) : (
                        "—"
                      )}
                    </dd>
                  </dl>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Pager renders once anything is beyond page one, and stays visible on
          later pages so "Previous" is always reachable. */}
      {!loading && (auditPage > 0 || auditHasMore) && (
        <nav
          aria-label="Audit log pages"
          className="mt-3 flex items-center gap-3 border-t border-line pt-3"
        >
          <button
            type="button"
            onClick={() => loadAudit(auditPage - 1)}
            disabled={auditLoading || auditPage === 0}
            className={buttonSecondary}
          >
            Previous
          </button>
          <span className="text-sm text-muted" aria-current="page">
            Page {auditPage + 1}
          </span>
          <button
            type="button"
            onClick={() => loadAudit(auditPage + 1)}
            disabled={auditLoading || !auditHasMore}
            className={buttonSecondary}
          >
            Next
          </button>
        </nav>
      )}

      {confirmDialog}
      <LoadingOverlay show={busy || working} message="Saving…" />
    </div>
  );
}
