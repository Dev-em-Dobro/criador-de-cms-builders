// @cms-core/cli — helper de poll com backoff (Fase 4, §7.5).
//
// Recoverable failures (timeout de poll, rate limit) → retry com backoff. Nos
// testes o `pollIntervalMs` é 0 (não espera de verdade) e `maxPolls` é baixo,
// então o poll é rápido e determinístico.

export interface PollOptions {
  maxPolls: number;
  intervalMs: number;
}

const sleep = (ms: number): Promise<void> =>
  ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();

/**
 * Chama `check()` até retornar um valor não-null ou esgotar `maxPolls`.
 * `check()` retorna o resultado quando "pronto", ou null para continuar.
 * Lança se esgotar (caller trata como recoverable/failed).
 */
export async function pollUntil<T>(
  check: () => Promise<T | null>,
  opts: PollOptions,
  onPoll?: (attempt: number) => void,
): Promise<T> {
  for (let attempt = 1; attempt <= opts.maxPolls; attempt++) {
    onPoll?.(attempt);
    const result = await check();
    if (result !== null) return result;
    if (attempt < opts.maxPolls) await sleep(opts.intervalMs);
  }
  throw new Error(`poll esgotou após ${opts.maxPolls} tentativas`);
}
