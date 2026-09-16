"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { StatusMessage, input, buttonPrimary } from "@cms-core/core/ui";

export default function LoginForm({
  initialStep = "password",
  brandTitle,
}: {
  initialStep?: "password" | "mfa";
  /** Rótulo de marca — vem de branding.adminTitle via a page (Server). */
  brandTitle: string;
}) {
  const router = useRouter();
  const [step, setStep] = useState<"password" | "mfa">(initialStep);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);

  // Moving to the MFA step is a context change — put focus where input is due.
  useEffect(() => {
    if (step === "mfa") codeRef.current?.focus();
  }, [step]);

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = await res.json();
      if (!res.ok) return setError(body.error ?? "Login failed");

      /**
       * Branch on `next`, not on a challenge id. "enrol" and "mfa" both follow
       * a valid password and both look like aal1 — the difference is whether a
       * verified factor exists, and they need opposite destinations.
       */
      if (body.next === "enrol") {
        router.push("/auth/enrol");
      } else if (body.next === "mfa") {
        setStep("mfa");
      } else {
        router.push("/");
      }
      router.refresh();
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
      const body = await res.json();
      if (!res.ok) return setError(body.error ?? "Verification failed");
      router.push("/");
      router.refresh();
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
      <h1 className="mt-1 mb-6 text-2xl font-bold text-ink">CMS sign in</h1>

      {/* Errors render above the form so they precede the fields they describe. */}
      {error && <StatusMessage tone="error" className="mb-4">{error}</StatusMessage>}

      {step === "password" ? (
        <form onSubmit={submitPassword} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className="text-sm font-medium text-ink">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={input}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-sm font-medium text-ink">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={input}
            />
          </div>
          <button disabled={busy} aria-busy={busy} className={buttonPrimary}>
            {busy ? "Signing in…" : "Continue"}
          </button>
          <Link
            href="/auth/recover"
            className="self-start text-sm text-muted underline"
          >
            Forgot your password?
          </Link>
        </form>
      ) : (
        <form onSubmit={submitMfa} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="code" className="text-sm font-medium text-ink">
              Verification code
            </label>
            <p id="code-hint" className="text-sm text-muted">
              Enter the 6-digit code from your authenticator app.
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
            {busy ? "Verifying…" : "Verify"}
          </button>
        </form>
      )}
    </main>
  );
}
