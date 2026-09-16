// @cms-core/cli — gen-facets (S2.5, R3).
//
// Lê `config.collections[].facets` e emite `db/schema/facets.generated.ts` com,
// para CADA coleção que declara facets:
//   (A) uma tabela Drizzle `pgTable("<type>_facets", …)` com `entryId` PK/FK
//       cascade + uma coluna `text().array().notNull().default('{}')` por facet +
//       um índice GIN por coluna;
//   (B) um `FacetPort` gerado (5 métodos: extract/upsert/filter/read/listFiltered)
//       funcionalmente equivalente ao `FacetPort` MANUAL de `core-runtime.ts`
//       (ADR-003 §3.4). O cliente passa a injetar o gerado em vez do manual.
//
// Byte-identidade do schema: o alvo real é `caseStudyFacets` (db/schema/content.ts)
// — tabela `case_study_facets` com PK `entryId`, colunas industry/service/
// region_slugs/outcome text[] NOT NULL default '{}'. O gerado renomeia a tabela
// para `case_facets` (via `<type>_facets`) e ADICIONA índices GIN (AC1). A
// migration de rename+GIN é gerada por `drizzle-kit generate` (AC8/T7).
//
// Mapeamento de nomes (o ponto crítico — o rename region→region_slugs):
//   • facet.name       → chave do query param no read API + chave em `data.facets`
//                        (ex.: "region")
//   • facet.column     → nome da coluna Postgres (default = name; ex.: "region_slugs")
//   • columnProp       → propriedade JS da tabela Drizzle = camelCase de column
//                        (ex.: "regionSlugs")
//
// FONTE DO `extract` (ADR-003 §3.4 + AUTO-DECISION S2.5): o `extract` GERADO lê
// `data.facets` (o objeto que agrupa os valores por facet.name), reproduzindo
// BYTE-A-BYTE `extractCaseFacets` do gold (`engine/types.ts`) que o FacetPort
// manual delega. O `sourceField` do baseline ancora o campo sintético `uiHidden`
// para a validação do config (AC6 de S0.1) — NÃO é a chave de runtime dos dados;
// o gold sempre leu `data.facets`. Preservamos a equivalência funcional provada
// (87 testes + extração da Fase 1) em vez de trocar a chave de runtime.
//
// Determinismo (ADR-003 §7.3 D1/D2): colunas e índices na ORDEM do array
// `facets`; coleções na ordem do array `collections`. Zero Set/Object reordenado.

import { resolve } from "node:path";
import type { ClientConfig, FacetConfig } from "@cms-core/core/config";
import { GENERATED_HEADER, tsString, writeGenerated } from "./shared.js";

/** Converte um nome de coluna snake_case para a propriedade JS camelCase que o
 * Drizzle expõe na tabela (ex.: "region_slugs" → "regionSlugs"). */
export function columnProp(column: string): string {
  return column.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/** Nome da constante da tabela Drizzle gerada para um tipo (ex.: "case" →
 * "caseFacets"). Sanitiza `_` do type (ex.: "page_legal" → "pageLegalFacets"). */
export function tableConst(type: string): string {
  return `${columnProp(type)}Facets`;
}

/** Metadados normalizados de um facet (resolvendo defaults de column/sourceField). */
interface ResolvedFacet {
  /** query-param / chave em data.facets (facet.name) */
  name: string;
  /** coluna Postgres (facet.column ?? facet.name) */
  column: string;
  /** propriedade JS da tabela (camelCase da coluna) */
  prop: string;
}

function resolveFacets(facets: FacetConfig[]): ResolvedFacet[] {
  return facets.map((f) => {
    const column = f.column ?? f.name;
    return { name: f.name, column, prop: columnProp(column) };
  });
}

/** Coleções que declaram ao menos um facet (na ordem do array `collections`). */
interface FacetedCollection {
  type: string;
  facets: ResolvedFacet[];
}

export function facetedCollections(config: ClientConfig): FacetedCollection[] {
  const out: FacetedCollection[] = [];
  for (const c of config.collections) {
    if (c.facets && c.facets.length > 0) {
      out.push({ type: c.type, facets: resolveFacets(c.facets) });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Renderização do schema Drizzle (uma pgTable + índices GIN por coleção).
// ---------------------------------------------------------------------------

function renderTable(fc: FacetedCollection): string {
  const tableName = `${fc.type}_facets`;
  const konst = tableConst(fc.type);

  const columns = fc.facets
    .map(
      (f) =>
        `    ${f.prop}: text(${tsString(f.column)}).array().notNull().default(sql\`'{}'::text[]\`),`,
    )
    .join("\n");

  // Um índice GIN por coluna de facet (AC1). Nome: `<type>_facets_<column>_idx`.
  const indexes = fc.facets
    .map(
      (f) =>
        `    index(${tsString(`${fc.type}_facets_${f.column}_idx`)}).using("gin", ${konst}.${f.prop}),`,
    )
    .join("\n");

  return `export const ${konst} = pgTable(
  ${tsString(tableName)},
  {
    entryId: uuid("entry_id")
      .primaryKey()
      .references(() => contentEntries.id, { onDelete: "cascade" }),
${columns}
  },
  (${konst}) => [
${indexes}
  ],
);

export type ${capitalize(konst)} = typeof ${konst}.$inferSelect;`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Indenta cada linha não-vazia de um bloco por `spaces` espaços (formatação
 * estável ao embutir blocos de nível 2 dentro de métodos de nível 4). */
function indentBlock(block: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return block
    .split("\n")
    .map((line) => (line.length > 0 ? pad + line : line))
    .join("\n");
}

// ---------------------------------------------------------------------------
// Renderização do FacetPort gerado (5 métodos, gated por type).
// ---------------------------------------------------------------------------

function renderFacetPort(faceted: FacetedCollection[]): string {
  // Para cada método, um bloco `if (type === "<t>") { … }` por coleção faceta,
  // reproduzindo a lógica do FacetPort manual de core-runtime.ts.

  const extractBlocks = faceted
    .map((fc) => {
      // extract: lê `data.facets` (equivalência com extractCaseFacets) e mapeia
      // data.facets[facet.name] → { [columnProp]: [...] }. Byte-idêntico ao gold.
      const assigns = fc.facets
        .map((f) => `      ${f.prop}: f[${tsString(f.name)}] ?? [],`)
        .join("\n");
      return `  if (type === ${tsString(fc.type)}) {
    const f = (data.facets ?? {}) as Record<string, string[] | undefined>;
    return {
${assigns}
    };
  }`;
    })
    .join("\n");

  const upsertBlocks = faceted
    .map((fc) => {
      const values = fc.facets
        .map((f) => `      ${f.prop}: facets[${tsString(f.prop)}] ?? [],`)
        .join("\n");
      const konst = tableConst(fc.type);
      return `  if (type === ${tsString(fc.type)}) {
    const values = {
${values}
    };
    await (tx as unknown as PgDb)
      .insert(${konst})
      .values({ entryId, ...values })
      .onConflictDoUpdate({ target: ${konst}.entryId, set: values });
    return;
  }`;
    })
    .join("\n");

  const filterBlocks = faceted
    .map((fc) => {
      const konst = tableConst(fc.type);
      const conds = fc.facets
        .map(
          (f) =>
            `    if (params[${tsString(f.name)}]?.length)\n      conds.push(arrayOverlaps(${konst}.${f.prop}, params[${tsString(f.name)}]!));`,
        )
        .join("\n");
      return `  if (type === ${tsString(fc.type)}) {
    const conds: SQL[] = [];
${conds}
    return conds;
  }`;
    })
    .join("\n");

  const readBlocks = faceted
    .map((fc) => {
      const konst = tableConst(fc.type);
      // read: retorna o shape do read API keyed por facet.name (não columnProp).
      const shape = fc.facets
        .map((f) => `      ${f.name}: row.${f.prop},`)
        .join("\n");
      return `  if (type === ${tsString(fc.type)}) {
    const [row] = await (db as unknown as PgDb)
      .select()
      .from(${konst})
      .where(eq(${konst}.entryId, entryId));
    if (!row) return null;
    return {
${shape}
    };
  }`;
    })
    .join("\n");

  const listFilteredBlocks = faceted
    .map((fc) => {
      const konst = tableConst(fc.type);
      const facetShape = fc.facets
        .map((f) => `        ${f.name}: r.facets.${f.prop},`)
        .join("\n");
      return `  if (type === ${tsString(fc.type)}) {
    const cdb = db as unknown as PgDb;
    const conds = [
      ...(baseConds as SQL[]),
      ...(filterPredicates(type, params) as SQL[]),
    ];
    const rows = await cdb
      .select({ entry: contentEntries, facets: ${konst} })
      .from(contentEntries)
      .innerJoin(${konst}, eq(${konst}.entryId, contentEntries.id))
      .where(and(...conds))
      .orderBy(desc(contentEntries.publishedAt))
      .limit(paging.pageSize)
      .offset(paging.offset);
    const [{ total }] = await cdb
      .select({ total: sql<number>\`count(*)::int\` })
      .from(contentEntries)
      .innerJoin(${konst}, eq(${konst}.entryId, contentEntries.id))
      .where(and(...conds));
    return {
      rows: rows.map((r) => ({
        entry: r.entry as unknown as Record<string, unknown>,
        facets: {
${facetShape}
        },
      })),
      total,
    };
  }`;
    })
    .join("\n");

  return `/**
 * FacetPort gerado a partir de client.config.ts (S2.5). Funcionalmente
 * equivalente ao FacetPort escrito à mão da Fase 1 — o core nunca muda, só a
 * origem da implementação injetada (ADR-001 Decisão 1, ADR-003 §3.4).
 */

// \`filter\` é usado tanto no read API quanto internamente por \`listFiltered\`;
// extraído p/ função nomeada para reuso (o método \`filter\` do Port a delega).
function filterPredicates(
  type: string,
  params: Record<string, string[]>,
): SQL[] {
${filterBlocks}
  return [];
}

export const facetPort: FacetPort = {
  extract(type, data) {
${indentBlock(extractBlocks, 2)}
    return null;
  },

  async upsert(tx, type, entryId, facets) {
${indentBlock(upsertBlocks, 2)}
  },

  filter(type, params) {
    return filterPredicates(type, params);
  },

  async read(db, type, entryId) {
${indentBlock(readBlocks, 2)}
    return null;
  },

  async listFiltered(db, type, baseConds, params, paging) {
${indentBlock(listFilteredBlocks, 2)}
    return null;
  },
};`;
}

// ---------------------------------------------------------------------------
// Render principal do arquivo `facets.generated.ts`.
// ---------------------------------------------------------------------------

/** Renderiza o conteúdo de `facets.generated.ts` (função pura — testável). */
export function renderFacets(config: ClientConfig): string {
  const faceted = facetedCollections(config);

  // Config sem nenhuma coleção faceta: emite um arquivo mínimo (sem tabelas,
  // FacetPort que sempre retorna null). Mantém o import estável no cliente.
  if (faceted.length === 0) {
    return `${GENERATED_HEADER}
// Nenhuma coleção declara facets — FacetPort vazio.

import type { FacetPort } from "@cms-core/core/engine";

export const facetPort: FacetPort = {
  extract() {
    return null;
  },
  async upsert() {},
  filter() {
    return [];
  },
  async read() {
    return null;
  },
  async listFiltered() {
    return null;
  },
};
`;
  }

  const tables = faceted.map(renderTable).join("\n\n");
  const port = renderFacetPort(faceted);

  return `${GENERATED_HEADER}
// Tabelas <type>_facets + FacetPort derivados de client.config.ts (S2.5).
//
// Estrutura byte-idêntica ao caseStudyFacets gold (PK entryId, colunas text[]
// NOT NULL default '{}') + índices GIN por coluna. O FacetPort é funcionalmente
// equivalente à implementação manual da Fase 1.

import { and, arrayOverlaps, desc, eq, sql, type SQL } from "drizzle-orm";
import { index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { FacetPort } from "@cms-core/core/engine";
import { contentEntries } from "./content";

/** Drizzle db concreto do cliente (o Port tipa o \`tx\`/\`db\` como EngineDb genérico). */
type PgDb = PostgresJsDatabase<Record<string, unknown>>;

${tables}

${port}
`;
}

/** Gera `db/schema/facets.generated.ts` no workspace-alvo. */
export function genFacets(config: ClientConfig, workspaceDir: string): string {
  const outPath = resolve(workspaceDir, "db/schema/facets.generated.ts");
  writeGenerated(outPath, renderFacets(config));
  return outPath;
}
