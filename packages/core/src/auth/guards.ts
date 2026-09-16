// @cms-core/core/auth — guards de sessão/RBAC (S1.3b).
//
// Extraído de clients/demo-corp/lib/auth/guards.ts. LÓGICA IDÊNTICA —
// `db`→deps.db, `profiles`→deps.schema.profiles, `createClient` (server)→
// deps.supabase (factory injetada). `profiles` é lido pela conexão de CONTEÚDO
// injetada (correto para D5). Ref: ADR-001 Decisão 1 ("ponto sensível").
//
// NOTA sobre `cache()`: o original memoiza `resolve` com React `cache()` para
// que um render pass que bate em vários guards pague por isso UMA vez. Como o
// core não deve depender de `react`, a memoização por-request é injetada via
// `deps.cache` (o cliente passa `import { cache } from "react"`). Se ausente,
// usa identidade (sem memoização — comportamento correto, só sem otimização).

import { eq } from "drizzle-orm";
import type {
  AuthGuardsDeps,
  AuthGuards,
  SessionPayload,
  Assurance,
  Role,
  SupabaseAuthApi,
} from "./di.js";
import { assuranceFromClaims } from "./di.js";
import { AuthError } from "./errors.js";

type Profile = AuthGuardsDeps["schema"]["profiles"]["$inferSelect"];

interface Resolved {
  session: SessionPayload;
  profile: Profile;
  assurance: Assurance;
}

/** Identidade usada como fallback quando `deps.cache` não é fornecido. */
function identityCache<T>(fn: () => Promise<T>): () => Promise<T> {
  return fn;
}

export function createAuthGuards(deps: AuthGuardsDeps): AuthGuards {
  const { db, schema, supabase } = deps;
  const { profiles } = schema;
  const wrap = deps.cache ?? identityCache;

  async function resolveAssurance(
    sb: SupabaseAuthApi,
    aal: unknown,
  ): Promise<Assurance> {
    if (aal === "aal2") return "satisfied";

    // aal1 (or a JWT with no aal claim) is ambiguous: no factor at all, or one
    // not yet satisfied. Only the enrolled-factor list separates those.
    const { data, error } = await sb.auth.mfa.listFactors();
    if (error) return "pending"; // fail closed
    const verified = data?.totp?.filter((f) => f.status === "verified") ?? [];
    return assuranceFromClaims(aal, verified.length);
  }

  /**
   * Single resolution of "who is this request", memoized per render pass by the
   * injected `cache` (React `cache()` on the client). `getClaims()` verifies the
   * JWT against a cached JWKS (ES256, no network round-trip).
   */
  const resolve = wrap(async (): Promise<Resolved | null> => {
    const sb = await supabase();

    const { data, error } = await sb.auth.getClaims();
    const claims = data?.claims;
    if (error || !claims?.sub) return null;

    const [profile] = await db
      .select()
      .from(profiles)
      .where(eq(profiles.id, claims.sub as string));
    if (!profile) return null;

    const assurance = await resolveAssurance(sb, claims.aal);

    return {
      session: {
        sub: profile.id as string,
        role: profile.role as Role,
        email: profile.email as string,
      },
      profile: profile as Profile,
      assurance,
    };
  });

  async function requireSession(): Promise<SessionPayload> {
    const r = await resolve();
    if (!r) throw new AuthError(401, "Authentication required");

    if ((r.profile as { status: string }).status === "disabled") {
      throw new AuthError(403, "Account disabled");
    }

    if (r.assurance === "none") {
      throw new AuthError(403, "Second factor enrolment required", "enrol");
    }
    if (r.assurance === "pending") {
      throw new AuthError(403, "Second factor required", "mfa");
    }

    return r.session;
  }

  async function requireAdmin(): Promise<SessionPayload> {
    const s = await requireSession();
    if (s.role !== "admin") {
      throw new AuthError(403, "Administrator access required");
    }
    return s;
  }

  async function requireEnrolmentBootstrap(): Promise<SessionPayload> {
    const r = await resolve();
    if (!r) throw new AuthError(401, "Authentication required");
    if ((r.profile as { status: string }).status === "disabled") {
      throw new AuthError(403, "Account disabled");
    }
    if (r.assurance !== "none") {
      throw new AuthError(403, "A second factor is already enrolled");
    }
    return r.session;
  }

  async function currentUser(): Promise<Record<string, unknown> | null> {
    const r = await resolve();
    return (r?.profile as Record<string, unknown>) ?? null;
  }

  async function currentAssurance(): Promise<Assurance | null> {
    const r = await resolve();
    return r?.assurance ?? null;
  }

  return {
    requireSession,
    requireAdmin,
    requireEnrolmentBootstrap,
    currentUser,
    currentAssurance,
  };
}
