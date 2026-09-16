// @cms-core/config — builders mínimos (S0.3).
//
// Recebem um `ClientConfig` e produzem output estruturalmente equivalente aos
// literais hardcoded do `demo-corp-cms` (`REGISTRY`, `FIELDS`,
// `CONTENT_TYPES`, colunas de `caseStudyFacets`). São o gate de não-regressão
// da Fase 0 (§5.5 / §11.1 do doc de arquitetura).
//
// Artigo IV (No Invention): a implementação é MÍNIMA por design — só o
// suficiente para o teste de equivalência passar. A generalização completa
// (buildZodSchemas, codegen) é trabalho da Fase 2 (R1). Não antecipar aqui.

import type { ClientConfig, FacetConfig, FieldKind } from "./types.js";

/**
 * Espelho estrutural do `FieldSpec` do modelo
 * (`demo-corp-cms/lib/content/ui-fields.ts`). O `FieldConfig` do S0.1 tem
 * os mesmos campos + `validate?`; `buildFields` omite `validate` para casar 1:1
 * com o `FieldSpec` do modelo (que não tem esse campo).
 */
export interface FieldSpec {
  name: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  help?: string;
  uploadField?: string;
}

/**
 * Espelho estrutural do `ContentTypeDef` do modelo
 * (`demo-corp-cms/lib/content/types.ts`), restrito aos campos que o teste
 * de equivalência compara: `type`, `label`, `segment`, `singleton`. (`schema` e
 * `toListItem` do modelo são comportamento de runtime, fora do escopo da
 * equivalência estrutural da Fase 0.)
 */
export interface RegistryEntry {
  type: string;
  label: string;
  /** plural URL segment p/ coleções; `undefined` p/ singletons. */
  segment?: string;
  singleton: boolean;
}

/**
 * Ordem canônica dos content types (equivalente ao `CONTENT_TYPES` / enum
 * `content_type` do modelo). Deriva da ordem das coleções no config.
 */
export function buildContentTypes(config: ClientConfig): string[] {
  return config.collections.map((c) => c.type);
}

/**
 * Registry por tipo (equivalente ao `REGISTRY` do modelo). Preserva a ordem de
 * inserção das coleções do config como ordem das chaves do objeto.
 */
export function buildRegistry(
  config: ClientConfig,
): Record<string, RegistryEntry> {
  const registry: Record<string, RegistryEntry> = {};
  for (const col of config.collections) {
    const singleton = col.singleton === true;
    registry[col.type] = {
      type: col.type,
      label: col.label,
      // Singletons não têm segment no modelo (fica `undefined`).
      segment: singleton ? undefined : col.segment,
      singleton,
    };
  }
  return registry;
}

/**
 * Campos por tipo (equivalente ao `FIELDS` do modelo). Mapeia cada `FieldConfig`
 * para o formato `FieldSpec[]`, omitindo `validate` (que não existe no
 * `FieldSpec` do modelo). Preserva a ordem dos campos — a ordem é parte do
 * contrato de equivalência (AC8 de S0.3).
 */
export function buildFields(
  config: ClientConfig,
): Record<string, FieldSpec[]> {
  const fields: Record<string, FieldSpec[]> = {};
  for (const col of config.collections) {
    fields[col.type] = col.fields.map((f) => {
      const spec: FieldSpec = {
        name: f.name,
        label: f.label,
        kind: f.kind,
      };
      // Só inclui as chaves opcionais quando presentes, para casar exatamente a
      // forma dos objetos do `FIELDS` do modelo (que omite as chaves ausentes).
      if (f.required !== undefined) spec.required = f.required;
      if (f.help !== undefined) spec.help = f.help;
      if (f.uploadField !== undefined) spec.uploadField = f.uploadField;
      return spec;
    });
  }
  return fields;
}

/**
 * Facets de uma coleção (equivalente às colunas da tabela `<type>_facets`; para
 * `case`, à `caseStudyFacets` do modelo). Retorna `[]` se a coleção não declara
 * facets ou não existe.
 */
export function buildFacets(
  config: ClientConfig,
  type: string,
): FacetConfig[] {
  const col = config.collections.find((c) => c.type === type);
  return col?.facets ?? [];
}
