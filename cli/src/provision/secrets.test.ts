// S4.2 — testes de secrets (CSPRNG, redação, cofre nunca em texto plano).

import { describe, it, expect } from "vitest";
import {
  generateToken,
  generatePassword,
  SecretVault,
  redact,
} from "./secrets.js";

describe("generateToken (CSPRNG)", () => {
  it("gera valores distintos a cada chamada", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(40);
  });

  it("é base64url (sem +, /, =)", () => {
    const t = generateToken();
    expect(t).not.toMatch(/[+/=]/);
  });
});

describe("generatePassword (CSPRNG)", () => {
  it("respeita o tamanho e tem variedade de classes", () => {
    const p = generatePassword(20);
    expect(p.length).toBe(20);
    expect(p).toMatch(/[A-Z]/);
    expect(p).toMatch(/[a-z]/);
    expect(p).toMatch(/[0-9]/);
    expect(p).toMatch(/[!@#$%^&*\-_=+]/);
  });

  it("gera senhas distintas", () => {
    expect(generatePassword()).not.toBe(generatePassword());
  });
});

describe("SecretVault", () => {
  it("ensureGenerated é idempotente na run (não regenera)", () => {
    const v = new SecretVault();
    const first = v.ensureGenerated("readApiKey");
    const second = v.ensureGenerated("readApiKey");
    expect(first).toBe(second);
  });

  it("guarda coletados e devolve por chave", () => {
    const v = new SecretVault();
    v.set("supabaseServiceRoleKey", "SR_KEY");
    expect(v.get("supabaseServiceRoleKey")).toBe("SR_KEY");
    expect(v.has("supabaseServiceRoleKey")).toBe(true);
  });
});

describe("redact", () => {
  it("substitui qualquer valor do cofre por ***", () => {
    const v = new SecretVault();
    v.set("bunnyStorageKey", "SUPER_SECRET_KEY_123");
    const line = "BUNNY_STORAGE_KEY=SUPER_SECRET_KEY_123 gravado";
    expect(redact(line, v)).toBe("BUNNY_STORAGE_KEY=*** gravado");
  });

  it("não altera mensagens sem secrets", () => {
    const v = new SecretVault();
    v.set("readApiKey", "abcdefgh");
    expect(redact("nada aqui", v)).toBe("nada aqui");
  });
});
