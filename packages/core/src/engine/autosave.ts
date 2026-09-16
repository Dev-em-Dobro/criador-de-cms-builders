/**
 * Framework-agnostic auto-save scheduling. No DOM or network access, so it is
 * unit-testable in isolation. The consumer supplies an `onFire` callback that
 * performs the actual save when the debounce elapses or a flush is requested.
 */

export const AUTOSAVE_DELAY_MS = 10_000;

export interface SaveGate {
  /** There are unsaved changes. */
  dirty: boolean;
  /** The entry already exists (has an id) — auto-save never creates entries. */
  hasId: boolean;
  /** A write (manual/auto/restore) is already in flight. */
  inFlight: boolean;
  /** The current payload is valid (e.g. JSON fields parse). */
  payloadValid: boolean;
}

/** Pure decision: may we auto-save right now? */
export function shouldSave(g: SaveGate): boolean {
  return g.dirty && g.hasId && !g.inFlight && g.payloadValid;
}

export interface AutosaveScheduler {
  /** (Re)start the debounce window; each call coalesces with the previous. */
  schedule(): void;
  /** Fire immediately if a save is pending (used on blur). */
  flush(): void;
  /** Drop a pending save without firing. */
  cancel(): void;
  /** Whether a save is currently scheduled. */
  pending(): boolean;
}

export function createAutosaveScheduler(
  onFire: () => void,
  opts: { delayMs?: number } = {},
): AutosaveScheduler {
  const delayMs = opts.delayMs ?? AUTOSAVE_DELAY_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clear = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return {
    schedule() {
      clear();
      timer = setTimeout(() => {
        timer = null;
        onFire();
      }, delayMs);
    },
    flush() {
      if (timer !== null) {
        clear();
        onFire();
      }
    },
    cancel() {
      clear();
    },
    pending() {
      return timer !== null;
    },
  };
}
