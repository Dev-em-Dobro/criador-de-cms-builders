// S5.3 — testes do gerador gen-profiles (codegen condicional de `profiles`, D5).
//
// Provam que a tabela `profiles` tem colunas IDÊNTICAS entre providers e que a
// FK `profiles_id_auth_users_fk` → auth.users é a ÚNICA diferença: PRESENTE no
// caso Supabase, OMITIDA no caso Neon (§13.4), junto com o import `authUsers`.

import { describe, it, expect } from "vitest";
import { renderProfiles } from "./gen-profiles.js";
import { demoCorpConfig } from "../../../templates/config-examples/demo-corp.config.js";
import { demoCorpNeonConfig } from "../../../templates/config-examples/demo-corp-neon.config.js";

// Bloco de colunas que DEVE ser byte-idêntico entre providers (o coração da
// equivalência D5). Extraído entre a abertura da tabela e o fecho das colunas.
const COLUMN_LINES = [
  'id: uuid("id").primaryKey(),',
  'email: text("email").notNull().unique(),',
  'role: roleEnum("role").notNull().default("editor"),',
  'status: userStatusEnum("status").notNull().default("invited"),',
  'lastLoginAt: timestamp("last_login_at", { withTimezone: true }),',
  'createdAt: timestamp("created_at", { withTimezone: true })',
  'updatedAt: timestamp("updated_at", { withTimezone: true })',
];

const supa = renderProfiles(demoCorpConfig);
const neon = renderProfiles(demoCorpNeonConfig);

describe("gen-profiles — comum a ambos providers", () => {
  it("header AUTO-GERADO na primeira linha", () => {
    expect(supa.split("\n")[0]).toBe(
      "// AUTO-GERADO por cms-core generate — não editar",
    );
    expect(neon.split("\n")[0]).toBe(
      "// AUTO-GERADO por cms-core generate — não editar",
    );
  });

  it("emite a tabela `profiles` e os tipos Profile/NewProfile nos dois", () => {
    for (const out of [supa, neon]) {
      expect(out).toContain('export const profiles = pgTable(');
      expect(out).toContain(
        "export type Profile = typeof profiles.$inferSelect;",
      );
      expect(out).toContain(
        "export type NewProfile = typeof profiles.$inferInsert;",
      );
    }
  });

  it("colunas IDÊNTICAS entre supabase e neon (o coração da equivalência D5)", () => {
    for (const line of COLUMN_LINES) {
      expect(supa).toContain(line);
      expect(neon).toContain(line);
    }
    expect(supa).toContain('import { roleEnum, userStatusEnum } from "./enums";');
    expect(neon).toContain('import { roleEnum, userStatusEnum } from "./enums";');
  });

  it("é determinístico (mesmo config → mesmo output)", () => {
    expect(renderProfiles(demoCorpConfig)).toBe(supa);
    expect(renderProfiles(demoCorpNeonConfig)).toBe(neon);
  });
});

describe("gen-profiles — caso database=supabase (FK presente)", () => {
  it("importa authUsers de drizzle-orm/supabase", () => {
    expect(supa).toContain('import { authUsers } from "drizzle-orm/supabase";');
  });

  it("importa foreignKey de drizzle-orm/pg-core", () => {
    expect(supa).toContain(
      'import { pgTable, uuid, text, timestamp, foreignKey } from "drizzle-orm/pg-core";',
    );
  });

  it("emite o bloco foreignKey → authUsers.id com onDelete cascade", () => {
    expect(supa).toContain("foreignKey({");
    expect(supa).toContain("columns: [t.id],");
    expect(supa).toContain("foreignColumns: [authUsers.id],");
    expect(supa).toContain('name: "profiles_id_auth_users_fk",');
    expect(supa).toContain('}).onDelete("cascade"),');
  });
});

describe("gen-profiles — caso database=neon (FK omitida, §13.4)", () => {
  it("NÃO importa authUsers de drizzle-orm/supabase", () => {
    expect(neon).not.toContain("drizzle-orm/supabase");
    expect(neon).not.toContain("authUsers");
  });

  it("NÃO importa foreignKey (não é usado)", () => {
    expect(neon).toContain(
      'import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";',
    );
    expect(neon).not.toContain("foreignKey");
  });

  it("NÃO emite o bloco da FK profiles_id_auth_users_fk", () => {
    expect(neon).not.toContain("profiles_id_auth_users_fk");
    expect(neon).not.toContain("onDelete");
  });

  it("documenta o UUID espelhado sem FK cross-database (§13.4)", () => {
    expect(neon).toContain("UUID ESPELHADO");
    expect(neon).toContain("claims.sub == profiles.id");
  });
});
