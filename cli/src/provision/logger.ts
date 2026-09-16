// @cms-core/cli — logger com redação de secrets (S4.2, §7.6).
//
// Todo log passa por `redact()` antes de sair, garantindo que nenhum valor do
// cofre apareça em texto plano no console/CI. Guarda as linhas emitidas para os
// testes provarem que nenhum secret vazou.

import type { ProvisionLogger } from "./types.js";
import { redact, type SecretVault } from "./secrets.js";

export interface LoggerOptions {
  /** true → também escreve no console (default). false → só acumula (testes). */
  toConsole?: boolean;
  /** prefixo por linha (ex.: "[dry-run] "). */
  prefix?: string;
}

export function createLogger(
  vault: SecretVault,
  opts: LoggerOptions = {},
): ProvisionLogger {
  const lines: string[] = [];
  const toConsole = opts.toConsole ?? true;
  const prefix = opts.prefix ?? "";

  const emit = (level: "info" | "warn" | "plan", msg: string): void => {
    const redacted = redact(`${prefix}${msg}`, vault);
    lines.push(redacted);
    if (toConsole) {
      if (level === "warn") console.warn(redacted);
      else console.log(redacted);
    }
  };

  return {
    lines,
    info: (msg) => emit("info", msg),
    warn: (msg) => emit("warn", msg),
    plan: (msg) => emit("plan", `[plan] ${msg}`),
  };
}
