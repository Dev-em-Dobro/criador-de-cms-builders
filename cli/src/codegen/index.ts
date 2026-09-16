// @cms-core/cli — orquestrador dos geradores de codegen (S2.3).
//
// Roda os geradores na ordem invariável do pipeline (ADR-003 §4.1). S2.3
// implementa `gen-enums` (1) e `gen-content-types` (2); as stories seguintes
// (S2.5/S2.6/S2.7) estendem com facets/zod/ui-fields/theme/nav/env.

import type { ClientConfig } from "@cms-core/core/config";
import { genEnums } from "./gen-enums.js";
import { genProfiles } from "./gen-profiles.js";
import { genContentTypes } from "./gen-content-types.js";
import { genFacets } from "./gen-facets.js";
import { genZod } from "./gen-zod.js";
import { genUiFields } from "./gen-ui-fields.js";
import { genTheme } from "./gen-theme.js";
import { genNav } from "./gen-nav.js";
import { genEnv } from "./gen-env.js";

export interface GenerateResult {
  written: string[];
}

export interface CodegenOptions {
  /**
   * Nome do export do `client.config.ts` (ex.: "demoCorpConfig"). Usado pelos
   * geradores de runtime-call (gen-zod/gen-ui-fields) para emitir o import do
   * config. Default: "default".
   */
  configExportName?: string;
}

/**
 * Executa todos os geradores implementados sobre `config`, escrevendo os
 * artefatos em `workspaceDir`. Retorna a lista de arquivos gerados.
 *
 * Ordem do pipeline (ADR-003 §4.1 / S2.6 T7 / S2.7 AC3 / S5.3):
 * gen-enums → gen-profiles → gen-content-types → gen-facets → gen-zod →
 * gen-ui-fields → gen-theme → gen-nav → gen-env (SEMPRE por último). O gen-env e
 * o gen-profiles são os ÚNICOS conscientes do `database.kind` (D5): gen-env varia
 * só as connection strings (`.env.local`); gen-profiles varia só a FK auth de
 * `profiles` (§13.4). Nenhum outro `*.ts/*.css` gerado muda entre providers.
 */
export function runCodegen(
  config: ClientConfig,
  workspaceDir: string,
  opts: CodegenOptions = {},
): GenerateResult {
  const configExportName = opts.configExportName ?? "default";
  const written: string[] = [];
  written.push(genEnums(config, workspaceDir));
  written.push(genProfiles(config, workspaceDir));
  written.push(genContentTypes(config, workspaceDir));
  written.push(genFacets(config, workspaceDir));
  written.push(genZod(config, workspaceDir, configExportName));
  written.push(genUiFields(config, workspaceDir, configExportName));
  written.push(genTheme(config, workspaceDir));
  written.push(genNav(config, workspaceDir));
  written.push(genEnv(config, workspaceDir));
  return { written };
}

export { renderEnums, genEnums } from "./gen-enums.js";
export { renderProfiles, genProfiles } from "./gen-profiles.js";
export { renderContentTypes, genContentTypes } from "./gen-content-types.js";
export {
  renderFacets,
  genFacets,
  facetedCollections,
  columnProp,
  tableConst,
} from "./gen-facets.js";
export { renderZod, genZod } from "./gen-zod.js";
export { renderUiFields, genUiFields } from "./gen-ui-fields.js";
export { renderTheme, genTheme, fontVarName } from "./gen-theme.js";
export { renderNav, genNav } from "./gen-nav.js";
export {
  renderEnv,
  genEnv,
  buildDbUrls,
  secretsFromEnv,
  type EnvSecrets,
} from "./gen-env.js";
