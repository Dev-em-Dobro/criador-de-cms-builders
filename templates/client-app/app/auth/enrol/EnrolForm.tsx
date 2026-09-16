"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { StatusMessage, input, buttonPrimary, buttonQuiet } from "@cms-core/core/ui";

interface Enrolment {
  factorId: string;
  qrCodeSvg: string;
  secret: string;
}

export default function EnrolForm({ brandTitle }: { brandTitle: string }) {
  const router = useRouter();
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [busy, setBusy] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);
  const started = useRef(false);

  useEffect(() => {
    // Guard against React's double-invoke in development: enrolling twice
    // would create a second unverified factor against the 10-factor cap.
    if (started.current) return;
    started.current = true;

    (async () => {
      try {
        const res = await fetch("/api/auth/mfa/enrol", { method: "POST" });
        const body = await res.json();
        if (!res.ok) return setError(body.error ?? "Could not start enrolment.");
        setEnrolment(body);
      } catch {
        setError("Could not reach the server. Check your connection and retry.");
      }
    })();
  }, []);

  useEffect(() => {
    if (enrolment) codeRef.current?.focus();
  }, [enrolment]);

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (!enrolment) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/mfa/enrol/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ factorId: enrolment.factorId, code }),
      });
      const body = await res.json();
      if (!res.ok) return setError(body.error ?? "Verification failed.");
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
      <h1 className="mt-1 text-2xl font-bold text-ink">Set up your second factor</h1>
      <p className="mt-2 mb-6 text-sm text-muted">
        Your account needs an authenticator app before you can use the CMS. This
        is a one-time setup.
      </p>

      {error && (
        <StatusMessage tone="error" className="mb-4">
          {error}
        </StatusMessage>
      )}

      {!enrolment && !error && (
        <p className="text-sm text-muted">Preparing your code…</p>
      )}

      {enrolment && (
        <>
          <div className="mb-4 flex justify-center rounded border border-line-strong bg-white p-4">
            {/*
              Supabase already returns qr_code as a `data:image/svg+xml,...`
              URI, despite the docs describing it as SVG to be converted. Both
              forms are handled: wrapping an already-wrapped value double-
              encodes it and silently renders a broken image, which is the kind
              of thing that only shows up when a real person tries to scan it.
            */}
            <img
              src={
                enrolment.qrCodeSvg.startsWith("data:")
                  ? enrolment.qrCodeSvg
                  : `data:image/svg+xml;utf-8,${encodeURIComponent(enrolment.qrCodeSvg)}`
              }
              alt="QR code for your authenticator app"
              width={200}
              height={200}
            />
          </div>

          <p className="mb-2 text-sm text-muted">
            Scan this with Google Authenticator, 1Password, or any TOTP app.
          </p>

          {/* Manual entry matters: some devices cannot scan, and some users
              run their authenticator on the same machine as the browser. */}
          <button
            type="button"
            onClick={() => setShowSecret((v) => !v)}
            className={`${buttonQuiet} mb-4 self-start px-0`}
            aria-expanded={showSecret}
          >
            {showSecret ? "Hide setup key" : "Can't scan? Enter a key instead"}
          </button>
          {showSecret && (
            <code className="mb-4 block break-all rounded border border-line-strong bg-paper p-3 text-xs text-ink">
              {enrolment.secret}
            </code>
          )}

          <form onSubmit={confirm} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="code" className="text-sm font-medium text-ink">
                Verification code
              </label>
              <p id="code-hint" className="text-sm text-muted">
                Enter the 6-digit code your app is showing now.
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
              {busy ? "Verifying…" : "Finish setup"}
            </button>
          </form>

          <p className="mt-4 text-xs text-muted">
            Code attempts are limited to 15 per hour across your whole network,
            not per person. If you see a rate-limit message, wait rather than
            retrying.
          </p>
        </>
      )}
    </main>
  );
}
