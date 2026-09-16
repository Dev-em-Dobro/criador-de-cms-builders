// @cms-core/core/engine — serviço de usuários (S1.3b).
//
// Extraído de clients/demo-corp/lib/users/service.ts. LÓGICA IDÊNTICA —
// `db`→deps.db, `profiles`→deps.schema.profiles, `createAdminClient`→
// deps.supabaseAdmin (factory injetada). Ref: ADR-001 Decisão 1.

import { and, eq, ne, sql } from "drizzle-orm";
import type { EngineDb, EngineSchema } from "./di.js";
import { ConflictError, NotFoundError } from "./errors.js";

export type Role = "admin" | "editor";
export type UserStatus = "active" | "invited" | "disabled";

/**
 * Ban duration used to disable an account at the Supabase level. Roughly 100
 * years — Supabase has no "ban indefinitely".
 */
const BAN_FOREVER = "876000h";

export interface InviteUserInput {
  email: string;
  role: Role;
}

export interface UpdateUserInput {
  role?: Role;
  status?: UserStatus;
}

/**
 * Cliente admin do Supabase que o serviço consome. Modelado estruturalmente
 * (subset) para o core não depender de `@supabase/supabase-js` na assinatura
 * pública. O `deps.supabaseAdmin` é o `createAdminClient` do cliente.
 */
export interface SupabaseAdminApi {
  auth: {
    admin: {
      inviteUserByEmail(email: string): Promise<{
        data: { user: { id: string } };
        error: { status?: number; message: string } | null;
      }>;
      updateUserById(
        id: string,
        attrs: { ban_duration: string },
      ): Promise<{ error: { message: string } | null }>;
      deleteUser(id: string): Promise<{ error: { message: string } | null }>;
      mfa: {
        listFactors(args: { userId: string }): Promise<{
          data: { factors?: Array<{ id: string }> } | null;
          error: { message: string } | null;
        }>;
        deleteFactor(args: { id: string; userId: string }): Promise<{
          error: { message: string } | null;
        }>;
      };
    };
  };
}

export type SupabaseAdminFactory = () => SupabaseAdminApi;

export interface UsersDeps {
  db: EngineDb;
  schema: Pick<EngineSchema, "profiles">;
  supabaseAdmin: SupabaseAdminFactory;
}

export function createUsersApi(deps: UsersDeps) {
  const { db, schema, supabaseAdmin } = deps;
  const { profiles } = schema;

  async function listUsers() {
    return db
      .select({
        id: profiles.id,
        email: profiles.email,
        role: profiles.role,
        status: profiles.status,
        lastLoginAt: profiles.lastLoginAt,
        createdAt: profiles.createdAt,
      })
      .from(profiles)
      .orderBy(profiles.createdAt);
  }

  async function activeAdminCount(excludeId?: string): Promise<number> {
    const conds = [eq(profiles.role, "admin"), eq(profiles.status, "active")];
    if (excludeId) conds.push(ne(profiles.id, excludeId));
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(profiles)
      .where(and(...conds));
    return n;
  }

  async function inviteUser(input: InviteUserInput) {
    const email = input.email.toLowerCase().trim();
    const admin = supabaseAdmin();

    const { data, error } = await admin.auth.admin.inviteUserByEmail(email);
    if (error) {
      if (error.status === 422 || /already/i.test(error.message)) {
        throw new ConflictError("A user with that email already exists");
      }
      throw error;
    }

    const [profile] = await db
      .insert(profiles)
      .values({ id: data.user.id, email, role: input.role, status: "invited" })
      .returning();

    return profile;
  }

  async function updateUser(id: string, patch: UpdateUserInput) {
    const [target] = await db
      .select()
      .from(profiles)
      .where(eq(profiles.id, id));
    if (!target) throw new NotFoundError("User not found");

    const nextRole: Role = patch.role ?? (target.role as Role);
    const nextStatus: UserStatus =
      patch.status ?? (target.status as UserStatus);

    const losingAdmin =
      target.role === "admin" &&
      (nextRole !== "admin" || nextStatus !== "active");
    if (losingAdmin && (await activeAdminCount(id)) === 0) {
      throw new ConflictError("Cannot remove the last active administrator");
    }

    if (nextStatus !== target.status) {
      const admin = supabaseAdmin();
      const { error } = await admin.auth.admin.updateUserById(id, {
        ban_duration: nextStatus === "disabled" ? BAN_FOREVER : "none",
      });
      if (error) throw error;
    }

    const [profile] = await db
      .update(profiles)
      .set({ role: nextRole, status: nextStatus, updatedAt: new Date() })
      .where(eq(profiles.id, id))
      .returning();

    return profile;
  }

  async function resetMfa(id: string): Promise<void> {
    const [target] = await db
      .select()
      .from(profiles)
      .where(eq(profiles.id, id));
    if (!target) throw new NotFoundError("User not found");

    const admin = supabaseAdmin();
    const { data, error } = await admin.auth.admin.mfa.listFactors({
      userId: id,
    });
    if (error) throw error;

    for (const factor of data?.factors ?? []) {
      const { error: delError } = await admin.auth.admin.mfa.deleteFactor({
        id: factor.id,
        userId: id,
      });
      if (delError) throw delError;
    }
  }

  async function deleteUser(id: string): Promise<void> {
    const [target] = await db
      .select()
      .from(profiles)
      .where(eq(profiles.id, id));
    if (!target) throw new NotFoundError("User not found");

    if (target.role === "admin" && (await activeAdminCount(id)) === 0) {
      throw new ConflictError("Cannot remove the last active administrator");
    }

    const admin = supabaseAdmin();
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) throw error;

    // (D5 / S5.4 / §13.4) Remoção EXPLÍCITA do `profiles`, sem depender da FK
    // cascade. No caso database=supabase a FK `profiles_id_auth_users_fk`
    // (onDelete cascade) já removeu esta linha quando o `auth.users` acima foi
    // deletado — este delete vira um no-op idempotente. No caso database=neon
    // NÃO existe FK cross-database (§13.4): sem este delete o `profiles` ficaria
    // ÓRFÃO silencioso após o usuário sumir do Supabase auth-only. Fazer o delete
    // em código torna a remoção física provider-agnóstica e correta nos dois.
    // (A desativação — updateUser status="disabled" — nunca dependeu da FK e já
    // é provider-agnóstica; é o caminho recomendado da v1.)
    await db.delete(profiles).where(eq(profiles.id, id));
  }

  return {
    listUsers,
    inviteUser,
    updateUser,
    resetMfa,
    deleteUser,
  } as const;
}
