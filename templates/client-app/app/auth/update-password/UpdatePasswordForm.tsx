"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { StatusMessage, input, buttonPrimary } from "@cms-core/core/ui";

/**
 * Two-phase form: the password fields, and — only when the API demands it —
 * an inline MFA challenge. A recovery link grants an aal1 session, and for an
 * account with a verified factor the password API refuses at aal1 with
 * `next: "mfa"`; satisfying the code here and retrying keeps the whole flow on
 * one screen instead of bouncing through the login page mid-recovery.
 */
export default function UpdatePasswordForm({ brandTitle }: { brandTitle: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [needsMfa, setNeedsMfa] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (needsMfa) codeRef.current?.focus();
  }, [needsMfa]);

  async function changePassword() {
    const res = await fetch("/api/auth/password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      router.push("/");
      router.refresh();
      return;
    }
    if (res.status === 403 && body.next === "mfa") {
      setNeedsMfa(true);
      return;
    }
    setError(body.error ?? "Could not update the password.");
  }

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("The passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await changePassword();
    } catch {
      setError("Could not reach the server. Check your connection and retry.");
    } finally {
      setBusy(false);
    }
  }

  async function submitMfa(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/mfa", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return setError(body.error ?? "Verification failed.");
      // Factor satisfied — the pending password change can now go through.
      await changePassword();
    } catch {
      setError("Could not reach the server. Check your connection and retry.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 py-10">
      <p className="text-xs font-semibold uppercase tracking-widest text-brand-dark">
        {brandTitle}
      </p>
      <h1 className="mt-1 mb-6 text-2xl font-bold text-ink">Set a new password</h1>

      {error && (
        <StatusMessage tone="error" className="mb-4">
          {error}
        </StatusMessage>
      )}

      {!needsMfa ? (
        <form onSubmit={submitPassword} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-sm font-medium text-ink">
              New password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={input}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="confirm" className="text-sm font-medium text-ink">
              Confirm new password
            </label>
            <input
              id="confirm"
              name="confirm"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={input}
            />
          </div>
          <button disabled={busy} aria-busy={busy} className={buttonPrimary}>
            {busy ? "Saving…" : "Save password"}
          </button>
        </form>
      ) : (
        <form onSubmit={submitMfa} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="code" className="text-sm font-medium text-ink">
              Verification code
            </label>
            <p id="code-hint" className="text-sm text-muted">
              Changing your password also needs the 6-digit code from your
              authenticator app.
            </p>
            <input
              id="code"
              ref={codeRef}
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              aria-describedby="code-hint"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className={`${input} tracking-widest`}
            />
          </div>
          <button disabled={busy} aria-busy={busy} className={buttonPrimary}>
            {busy ? "Verifying…" : "Verify and save"}
          </button>
        </form>
      )}
    </main>
  );
}
