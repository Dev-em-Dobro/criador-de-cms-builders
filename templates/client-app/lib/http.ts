import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { AuthError, ConflictError, NotFoundError } from "@/lib/errors";

export { AuthError, ConflictError, NotFoundError };

export function jsonOk(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function jsonError(
  status: number,
  message: string,
  extra?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json({ error: message, ...extra }, { status });
}

/** 422 with field-level validation detail (matches contracts/admin-api.md). */
export function jsonValidationError(
  errors: Record<string, string>,
): NextResponse {
  return NextResponse.json(
    { error: "Validation failed", fields: errors },
    { status: 422 },
  );
}

/** Map thrown errors (AuthError, edit conflicts, not-found) to responses. */
export function handleError(e: unknown): NextResponse {
  if (e instanceof AuthError) return jsonError(e.status, e.message);
  if (e instanceof ConflictError) return jsonError(409, e.message);
  if (e instanceof NotFoundError) return jsonError(404, e.message);
  console.error("[api] unhandled error:", e);
  return jsonError(500, "Internal error");
}

/** Client origin (IP + user-agent) for security audit events. */
export function clientMeta(req: Request): { ip: string; userAgent: string } {
  return {
    ip: (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim(),
    userAgent: req.headers.get("user-agent") ?? "unknown",
  };
}

/** Constant-time secret comparison. */
export function secretEquals(received: string | null, expected: string): boolean {
  if (!received) return false;
  // SHA-256 first: timingSafeEqual THROWS on length mismatch rather than
  // returning false, and comparing digests keeps response time from leaking
  // the expected key's length.
  const a = createHash("sha256").update(received).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * Validate the read API key. Callers must send a matching `x-api-key`.
 *
 * FAILS CLOSED when READ_API_KEY is unset. The previous behaviour returned
 * `true` there ("no key configured means public API"), which is a fail-open:
 * one missing variable in a deploy — a rename, a fresh environment, an
 * incomplete `vercel env` — silently published the client's whole content set.
 * Answering 401 by mistake is the cheaper failure: someone notices in minutes.
 */
export function readKeyValid(req: Request): boolean {
  const expected = process.env.READ_API_KEY;
  if (!expected) {
    console.error("[api] READ_API_KEY is not set — read API answering 401");
    return false;
  }
  return secretEquals(req.headers.get("x-api-key"), expected);
}

// --- Best-effort in-memory rate limiter ---------------------------------------
// NOTE: per-instance only (Fluid Compute reuses instances but does not share
// state globally). Adequate as a baseline for login/MFA throttling; a durable
// store (e.g. Neon/Upstash) can replace it later without changing call sites.
const buckets = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(
  key: string,
  max: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now > b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (b.count >= max) return false;
  b.count += 1;
  return true;
}
