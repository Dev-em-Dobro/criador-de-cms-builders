// @cms-core/core/auth — Contrato de injeção da factory de guards (ADR-001, Decisão 1).
//
// Mesma fábrica do engine: `createAuthGuards({ db, schema: { profiles }, supabase })`.
// O guard lê `profiles` via a conexão de CONTEÚDO injetada (`deps.db`) — correto
// para D5 (profiles mora junto do conteúdo; a ponte com o Supabase é o valor do
// UUID `claims.sub == profiles.id`, sem FK cross-DB). Nenhum hardcode de
// connection string ou nome de tabela.
//
// NOTA S1.3a: declara o CONTRATO (interfaces + assinatura) e um STUB da factory.
// O corpo real é preenchido em S1.3b, movendo a lógica de `guards.ts` do cliente
// para o core.

import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { profiles as profilesShape } from "../engine/schema-shape.js";
import { AuthError } from "./errors.js";

export { AuthError };

export type Role = "admin" | "editor";

export interface SessionPayload {
  sub: string; // auth.users id — mesmo valor que profiles.id
  role: Role;
  email: string;
}

/** Estado de assurance derivado do claim `aal` do JWT + fatores enrolados. */
export type Assurance = "none" | "pending" | "satisfied";

/** Port do schema exigido pelos guards (só `profiles` do núcleo). */
export interface AuthSchema {
  profiles: typeof profilesShape;
}

/** Drizzle db genérico sobre o schema do cliente. */
export type AuthDb = PostgresJsDatabase<Record<string, unknown>>;

/**
 * Cliente Supabase mínimo que os guards consomem. É o `createClient` do
 * servidor do cliente (SSR-aware, lê os cookies da request). Modelado
 * estruturalmente para o core não depender de `@supabase/ssr` na assinatura
 * pública — o corpo (S1.3b) usa o tipo concreto internamente.
 */
export interface SupabaseAuthApi {
  auth: {
    getClaims(): Promise<{
      data: { claims?: Record<string, unknown> | null } | null;
      error: unknown;
    }>;
    mfa: {
      listFactors(): Promise<{
        data: { totp?: Array<{ status: string }> } | null;
        error: unknown;
      }>;
    };
  };
}

export type SupabaseServerFactory = () =>
  | Promise<SupabaseAuthApi>
  | SupabaseAuthApi;

export interface AuthGuardsDeps {
  db: AuthDb;
  schema: AuthSchema;
  supabase: SupabaseServerFactory;
  /**
   * Memoização por render-pass (o cliente passa `import { cache } from "react"`).
   * Opcional — ausente => sem memoização (correto, só sem a otimização de pagar
   * a resolução uma vez por request). Ref: nota em `guards.ts`.
   */
  cache?: <T>(fn: () => Promise<T>) => () => Promise<T>;
}

/** Conjunto de guards retornado pela factory. */
export interface AuthGuards {
  requireSession(): Promise<SessionPayload>;
  requireAdmin(): Promise<SessionPayload>;
  requireEnrolmentBootstrap(): Promise<SessionPayload>;
  currentUser(): Promise<Record<string, unknown> | null>;
  currentAssurance(): Promise<Assurance | null>;
}

/**
 * Pure assurance resolution — exportado para teste unitário.
 * (Movido de `guards.ts`; independente de deps, fica no contrato.)
 */
export function assuranceFromClaims(
  aal: unknown,
  verifiedFactorCount: number,
): Assurance {
  if (aal === "aal2") return "satisfied";
  return verifiedFactorCount > 0 ? "pending" : "none";
}

// A factory `createAuthGuards` (corpo real) vive em `./guards.ts` e é
// re-exportada por `./index.ts`. Aqui ficam só os tipos do contrato.
