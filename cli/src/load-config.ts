// @cms-core/cli — carregamento e validação de um `client.config.ts` (S3.1).
//
// Extrai a lógica de resolver o caminho do config, importá-lo dinamicamente,
// escolher o export certo e validá-lo com `validateClientConfig` — compartilhada
// entre os comandos `validate`, `generate` e `create-client` da `cms-factory`.

import { resolve, dirname, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import {
  validateClientConfig,
  ClientConfigValidationError,
} from "@cms-core/core/config";
import type { ClientConfig } from "@cms-core/core/config";

export { ClientConfigValidationError };

export interface LoadedConfig {
  /** ClientConfig validado. */
  config: ClientConfig;
  /** Nome do export de onde o config veio (default/config/<nome>). */
  exportName: string;
  /** Caminho absoluto do arquivo de config. */
  configPath: string;
  /** Diretório do arquivo de config (workspace-alvo do codegen). */
  workspaceDir: string;
}

/** Resolve o caminho do config para absoluto a partir de `cwd`. */
export function resolveConfigPath(configArg: string, cwd = process.cwd()): string {
  return isAbsolute(configArg) ? configArg : resolve(cwd, configArg);
}

/**
 * Extrai o `ClientConfig` de um módulo de config carregado + o NOME do export.
 * O nome é usado pelos geradores de runtime-call (gen-zod/gen-ui-fields) para
 * emitir `import { <name> as clientConfig } from "@/client.config"`. Aceita
 * `default`, um export nomeado `config`, ou o primeiro export que seja objeto.
 */
export function pickConfig(mod: Record<string, unknown>): {
  value: unknown;
  exportName: string;
} {
  if (mod.default !== undefined) return { value: mod.default, exportName: "default" };
  if (mod.config !== undefined) return { value: mod.config, exportName: "config" };
  for (const [name, value] of Object.entries(mod)) {
    if (value && typeof value === "object") return { value, exportName: name };
  }
  throw new Error("cms-factory: nenhum export de config encontrado no arquivo.");
}

/**
 * Carrega + valida um `client.config.ts`. Lança `ClientConfigValidationError`
 * se o config for inválido (para a CLI reportar com exit ≠ 0).
 */
export async function loadClientConfig(
  configArg: string,
  cwd = process.cwd(),
): Promise<LoadedConfig> {
  const configPath = resolveConfigPath(configArg, cwd);
  const workspaceDir = dirname(configPath);
  const mod = (await import(pathToFileURL(configPath).href)) as Record<
    string,
    unknown
  >;
  const { value: raw, exportName } = pickConfig(mod);
  const config = validateClientConfig(raw);
  return { config, exportName, configPath, workspaceDir };
}
