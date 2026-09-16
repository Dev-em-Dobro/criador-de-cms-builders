// @cms-core/core/i18n — decisões puras do registro de idiomas (S1.4).
//
// Movido de clients/demo-corp/lib/content/locale-rules.ts SEM alteração
// (puro — só depende do tipo `Locale`). A factory DB-backed (`locales.ts`)
// compõe estas com queries.

import type { Locale } from "./schema-shape.js";

/** The default language's code: the one flagged default, else first, else "en". */
export function resolveDefault(locales: Locale[]): string {
  return locales.find((l) => l.isDefault)?.code ?? locales[0]?.code ?? "en";
}

/** Registry order for pickers/badges: by sortOrder, then code. */
export function sortLocales(locales: Locale[]): Locale[] {
  return [...locales].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code),
  );
}

/** A language can be disabled unless it is the current default. */
export function canDisable(code: string, locales: Locale[]): boolean {
  return locales.find((l) => l.isDefault)?.code !== code;
}

/** A language can be deleted only when it is neither default nor in use. */
export function canDelete(
  locale: { isDefault: boolean },
  inUse: number,
): boolean {
  return !locale.isDefault && inUse === 0;
}

/** Return the set with exactly one default (= newDefaultCode). */
export function nextDefaultSwap(
  locales: Locale[],
  newDefaultCode: string,
): Locale[] {
  return locales.map((l) => ({ ...l, isDefault: l.code === newDefaultCode }));
}
