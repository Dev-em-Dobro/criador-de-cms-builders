// @cms-core/config — registry de validadores nomeados (S2.2, R1 escape hatch).
//
// `validate.custom` em `FieldConfig` é resolvido por este registry. É o escape
// hatch para regras finas que não cabem em `validate.pattern` (arch §5 R1, linha
// "validadores custom nomeados"). O core pré-registra `youtubeUrl` e `hexColor`;
// o workspace-cliente pode registrar validadores adicionais chamando
// `registerNamedValidator(name, fn)` ANTES de `buildZodSchemas(config)`.
//
// IMPORTANTE (correção @po S2.2): os validadores NÃO são recodificados por
// suposição. `youtubeUrl` REUSA o `youtubeField` real do motor
// (`engine/youtube.ts`) — o comportamento (normaliza para {provider,videoId,url},
// round-trip de refs, blank→undefined, rejeita não-YouTube) é byte-idêntico ao
// gold-standard. `hexColor` reproduz o `brandColorField` real de
// `engine/ui-fields.ts` (preprocess ""→undefined + regex 6 dígitos + optional).
//
// Sem cycle de import: `engine/youtube.ts` é folha (só importa zod); não importa
// config. A aresta config/named-validators → engine/youtube é unidirecional.

import { z } from "zod";
import type { ZodTypeAny } from "zod";
import { youtubeField } from "../engine/youtube.js";

/**
 * Um validador nomeado recebe o schema-base do campo (derivado do `kind`) e
 * devolve o schema final com a regra fina aplicada. Alguns validadores
 * (ex.: `youtubeUrl`) SUBSTITUEM o base por um schema próprio; o base é passado
 * para os que apenas o refinam.
 */
export type NamedValidator = (base: ZodTypeAny) => ZodTypeAny;

// ── Validadores do core ──────────────────────────────────────────────────────

/**
 * `youtubeUrl` — aceita `watch?v=` / `youtu.be/` / `embed/` / `shorts/`, rejeita
 * outras URLs, normaliza para a referência canônica `{provider,videoId,url}`.
 * Blank ("") = não provido. REUSA o `youtubeField` real do motor — mesma
 * semântica do gold-standard (verificado em tests/unit/youtube.test.ts).
 */
const youtubeUrl: NamedValidator = () =>
  youtubeField as unknown as ZodTypeAny;

/**
 * `hexColor` — aceita `#RRGGBB` de 6 dígitos, rejeita outros. Blank ("") = não
 * provido. Reproduz o `brandColorField` real (preprocess ""→undefined + regex +
 * optional) — verificado em tests/unit/content-tags-branding.test.ts.
 */
const hexColor: NamedValidator = () =>
  z.preprocess(
    (v) => (v === "" ? undefined : v),
    z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, "Must be a 6-digit hex colour like #1a2b3c")
      .optional(),
  );

// ── Registry ─────────────────────────────────────────────────────────────────

const REGISTRY: Record<string, NamedValidator> = {
  youtubeUrl,
  hexColor,
};

/**
 * Registra (ou sobrescreve) um validador nomeado. O workspace-cliente chama isto
 * antes de `buildZodSchemas(config)` para estender o escape hatch.
 */
export function registerNamedValidator(
  name: string,
  fn: NamedValidator,
): void {
  REGISTRY[name] = fn;
}

/**
 * Resolve um validador nomeado. Fail-fast (na GERAÇÃO do schema, não em runtime)
 * se o nome não estiver registrado — um `validate.custom` desconhecido é um erro
 * de config, não uma condição silenciosa.
 */
export function resolveNamedValidator(name: string): NamedValidator {
  const fn = REGISTRY[name];
  if (!fn) {
    throw new Error(
      `Unknown named validator "${name}". Registered: ${Object.keys(REGISTRY)
        .sort()
        .join(", ")}. Register it via registerNamedValidator("${name}", fn) before buildZodSchemas(config).`,
    );
  }
  return fn;
}

/** Nomes registrados (para testes/diagnóstico). */
export function registeredValidatorNames(): string[] {
  return Object.keys(REGISTRY).sort();
}
