"use client";

import { useState } from "react";
import Link from "next/link";
import { StatusMessage, input, buttonPrimary } from "@cms-core/core/ui";

export default function RecoverForm({ brandTitle }: { brandTitle: string }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/recover", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return setError(body.error ?? "Something went wrong. Try again.");
      }
      setSent(true);
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
      <h1 className="mt-1 mb-6 text-2xl font-bold text-ink">Reset your password</h1>

      {error && (
        <StatusMessage tone="error" className="mb-4">
          {error}
        </StatusMessage>
      )}

      {sent ? (
        /* The same message regardless of whether the address exists — this
           screen must not confirm which emails have accounts. */
        <StatusMessage tone="success">
          If an account exists for {email || "that address"}, a reset link is on
          its way. Check your inbox — the link expires after a short while.
        </StatusMessage>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className="text-sm font-medium text-ink">
              Email
            </label>
            <p id="email-hint" className="text-sm text-muted">
              We&apos;ll send a link to set a new password.
            </p>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              aria-describedby="email-hint"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={input}
            />
          </div>
          <button disabled={busy} aria-busy={busy} className={buttonPrimary}>
            {busy ? "Sending…" : "Send reset link"}
          </button>
        </form>
      )}

      <Link href="/login" className="mt-6 text-sm text-muted underline">
        Back to sign in
      </Link>
    </main>
  );
}
