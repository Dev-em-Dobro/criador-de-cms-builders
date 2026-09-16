// S5.4 — teste do caminho de deleção de usuário provider-agnóstico (D5 / §13.4).
//
// Prova que `deleteUser` remove o `profiles` EXPLICITAMENTE (não depende da FK
// cascade auth.users→profiles, que só existe no caso database=supabase). No caso
// Neon não há FK cross-database, então sem esse delete o `profiles` ficaria
// órfão. O fake abaixo modela o subconjunto da cadeia Drizzle que o serviço usa.

import { describe, it, expect, vi } from "vitest";
import { createUsersApi, type SupabaseAdminApi } from "./users.js";
import type { EngineDb, EngineSchema } from "./di.js";

/**
 * Fake mínimo do `EngineDb` para o serviço de usuários. Captura os deletes e
 * responde às leituras de `profiles` a partir de uma tabela em memória.
 */
function makeFakeDb(rows: Array<{ id: string; role: string; status: string }>) {
  const deletes: string[] = [];

  // db.select(...).from(...).where(...) → resolve para um array (leitura de
  // profiles ou count de admins). Modelado de forma preguiçosa e "thenável".
  function selectChain(projection?: Record<string, unknown>) {
    let whereId: string | undefined;
    let excludeId: string | undefined;
    let isCount = projection !== undefined;
    const chain: Record<string, unknown> = {
      from() {
        return chain;
      },
      where(cond: { __id?: string; __count?: boolean; __excludeId?: string }) {
        whereId = cond?.__id;
        excludeId = cond?.__excludeId;
        if (cond?.__count) isCount = true;
        return chain;
      },
      orderBy() {
        return chain;
      },
      then(resolve: (v: unknown) => unknown) {
        if (isCount) {
          // activeAdminCount(excludeId): admins ativos, opcionalmente excluindo id.
          const n = rows.filter(
            (r) =>
              r.role === "admin" &&
              r.status === "active" &&
              (!excludeId || r.id !== excludeId),
          ).length;
          return resolve([{ n }]);
        }
        const found = whereId
          ? rows.filter((r) => r.id === whereId)
          : [...rows];
        return resolve(found);
      },
    };
    return chain;
  }

  const db = {
    select(projection?: Record<string, unknown>) {
      return selectChain(projection);
    },
    delete() {
      return {
        where(cond: { __id?: string }) {
          if (cond?.__id) deletes.push(cond.__id);
          const idx = rows.findIndex((r) => r.id === cond?.__id);
          if (idx >= 0) rows.splice(idx, 1);
          return Promise.resolve([]);
        },
      };
    },
  } as unknown as EngineDb;

  return { db, deletes, rows };
}

// `eq(profiles.id, id)` e `count(*)` são opacos ao serviço; o fake só precisa que
// `where(...)` receba um marcador. Fazemos `eq`/`sql` devolverem marcadores.
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: (_col: unknown, val: unknown) => ({ __id: val }),
    and: (...conds: unknown[]) => Object.assign({}, ...conds, { __count: true }),
    ne: (_col: unknown, val: unknown) => ({ __excludeId: val }),
    sql: Object.assign(() => ({ __count: true }), { raw: () => ({}) }),
  };
});

const schema = { profiles: { id: {}, role: {}, status: {} } } as unknown as Pick<
  EngineSchema,
  "profiles"
>;

function makeAdmin() {
  const deleted: string[] = [];
  const admin: SupabaseAdminApi = {
    auth: {
      admin: {
        inviteUserByEmail: async () => ({ data: { user: { id: "x" } }, error: null }),
        updateUserById: async () => ({ error: null }),
        deleteUser: async (id: string) => {
          deleted.push(id);
          return { error: null };
        },
        mfa: {
          listFactors: async () => ({ data: { factors: [] }, error: null }),
          deleteFactor: async () => ({ error: null }),
        },
      },
    },
  };
  return { admin, deleted };
}

describe("deleteUser — remoção provider-agnóstica do profiles (S5.4)", () => {
  it("deleta o auth.users E o profiles explicitamente (sem depender da FK cascade)", async () => {
    const { db, deletes } = makeFakeDb([
      { id: "u1", role: "editor", status: "active" },
      { id: "admin1", role: "admin", status: "active" },
    ]);
    const { admin, deleted } = makeAdmin();
    const api = createUsersApi({ db, schema, supabaseAdmin: () => admin });

    await api.deleteUser("u1");

    // Supabase auth.users foi deletado…
    expect(deleted).toEqual(["u1"]);
    // …e o profiles foi deletado EXPLICITAMENTE (o que salva o caso Neon do órfão).
    expect(deletes).toEqual(["u1"]);
  });

  it("recusa remover o último admin ativo (não toca no banco)", async () => {
    const { db, deletes } = makeFakeDb([
      { id: "admin1", role: "admin", status: "active" },
    ]);
    const { admin, deleted } = makeAdmin();
    const api = createUsersApi({ db, schema, supabaseAdmin: () => admin });

    await expect(api.deleteUser("admin1")).rejects.toThrow(
      /last active administrator/i,
    );
    expect(deleted).toEqual([]);
    expect(deletes).toEqual([]);
  });
});
