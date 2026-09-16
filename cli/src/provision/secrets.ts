// @cms-core/cli — secrets do provisionamento (S4.2, §7.6).
//
// Regras não-negociáveis (§7.6):
//   1. secrets NUNCA entram no state file em texto plano nem em arquivo commitado.
//   2. logs REDIGEM valores de secrets (nunca imprimem o valor).
//   3. a senha temporária do admin é impressa UMA ÚNICA VEZ no handoff.
//
// Todos os secrets gerados por nós usam CSPRNG (`node:crypto.randomBytes`).
// Os coletados dos providers (service_role key, bunny key, db password do Neon)
// entram no mesmo cofre em memória — que sabe se redigir.

import { randomBytes } from "node:crypto";

/** Chaves de secret conhecidas pelo cofre (para redação determinística). */
export type SecretKey =
  // gerados por nós (CSPRNG)
  | "readApiKey"
  | "webhookSigningKey"
  | "previewTokenSecret"
  | "seedAdminPassword"
  | "supabaseDbPassword"
  // coletados dos providers
  | "supabaseServiceRoleKey"
  | "supabasePublishableKey"
  | "bunnyStorageKey"
  | "neonPassword";

/** Gera N bytes aleatórios como base64url (CSPRNG). */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/**
 * Gera uma senha forte legível (para o admin trocar no 1º login). Usa CSPRNG,
 * garante variedade de classes e evita caracteres ambíguos. NÃO é guardada — é
 * impressa uma única vez no handoff (§7.6).
 */
export function generatePassword(length = 20): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnpqrstuvwxyz";
  const digits = "23456789";
  const symbols = "!@#$%^&*-_=+";
  const all = upper + lower + digits + symbols;
  const pick = (set: string): string => {
    // rejection sampling p/ evitar viés de módulo (CSPRNG, sem `%` enviesado).
    const max = 256 - (256 % set.length);
    let b: number;
    do {
      b = randomBytes(1)[0];
    } while (b >= max);
    return set[b % set.length];
  };
  // garante ao menos 1 de cada classe, depois preenche o resto.
  const out = [pick(upper), pick(lower), pick(digits), pick(symbols)];
  while (out.length < length) out.push(pick(all));
  // embaralha (Fisher–Yates com CSPRNG) p/ não fixar as classes no início.
  for (let i = out.length - 1; i > 0; i--) {
    const max = 256 - (256 % (i + 1));
    let b: number;
    do {
      b = randomBytes(1)[0];
    } while (b >= max);
    const j = b % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.join("");
}

/**
 * Cofre de secrets em memória. Guarda valores por chave; expõe redação para
 * logs; nunca serializa para o state file. Na v1 o destino de guarda é um
 * `secrets/<slug>.json` gerado FORA do repo (documentado no handoff, §7.6).
 */
export class SecretVault {
  private readonly store = new Map<string, string>();

  set(key: SecretKey, value: string): void {
    this.store.set(key, value);
  }

  get(key: SecretKey): string | undefined {
    return this.store.get(key);
  }

  has(key: SecretKey): boolean {
    return this.store.has(key);
  }

  /**
   * Gera (se ausente) um secret CSPRNG para a chave e retorna. Idempotente
   * dentro da run: não regenera se já foi coletado/gerado.
   */
  ensureGenerated(key: SecretKey, bytes = 32): string {
    const existing = this.store.get(key);
    if (existing) return existing;
    const v = generateToken(bytes);
    this.store.set(key, v);
    return v;
  }

  /** Todos os valores atualmente guardados (para redação de logs). */
  values(): string[] {
    return [...this.store.values()].filter((v) => v.length >= 6);
  }

  /**
   * Snapshot p/ o `secrets/<slug>.json` FORA do repo (nunca commitado). Retorna
   * o objeto; quem chama grava fora do repo e move para o cofre do operador.
   */
  snapshot(): Record<string, string> {
    return Object.fromEntries(this.store);
  }
}

/**
 * Redige quaisquer valores de secret presentes em uma string de log. Substitui
 * cada valor guardado por `***`. Também mascara padrões óbvios de token
 * (sequências base64url longas) como defesa em profundidade.
 */
export function redact(message: string, vault: SecretVault): string {
  let out = message;
  for (const v of vault.values()) {
    if (v && out.includes(v)) {
      out = out.split(v).join("***");
    }
  }
  return out;
}
