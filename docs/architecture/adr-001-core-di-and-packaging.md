# ADR-001 — Injeção de `db`+schema no core, estrutura de pacote e sequenciamento Fase 1↔2

> **Status:** ACEITA (2026-08-03)
> **Autor:** Aria (@architect)
> **Contexto:** design spike para destravar a Fase 1 (S1.3/S1.4). O @dev parou a extração do motor no último estado verde (11/20 arquivos extraídos; 9 diferidos) porque os arquivos DB-coupled batem num problema de design real. Ver `docs/stories/1.3.extract-engine-auth-media-to-core.md` (Dev Agent Record).
> **Escopo:** três decisões — (1) contrato de injeção `db`+schema no core; (2) estrutura/nome do pacote core; (3) sequenciamento Fase 1↔Fase 2.
> **Relacionado:** `cms-factory-architecture.md` §5, §6, §8, §10, §13.4; decisões travadas D1 (monorepo), D2 (codegen), D4/D5 (banco por cliente).

---

## Problema (fundamentado no código real)

Na extração do motor para `@cms-core`, 9 arquivos **acoplados ao banco** não podem só "mudar de pasta". O padrão de acoplamento é **uniforme** em todos eles (verificado):

```ts
import { db } from "@/db";                        // instância Drizzle ligada a DATABASE_URL (cliente)
import { contentEntries, caseStudyFacets, mediaAssets, profiles, ... } from "@/db/schema";
import { defForType, validateContent, ... } from "@cms-core/engine";  // puros — JÁ no core
```

- **`db`** (`clients/demo-corp/db/index.ts`): `drizzle(postgres(DATABASE_URL,{prepare:false}), { schema })`. É **propriedade do cliente** (banco por cliente — D4/D5).
- **tabelas** (`clients/demo-corp/db/schema/*`): objetos Drizzle concretos (`contentEntries`, `contentVersions`, `caseStudyFacets`, `mediaAssets`, `profiles`, `webhookEndpoints`, `auditLog`). Na Fase 2 (D2) o schema por-cliente será **codegen'd** a partir do `client.config.ts` — os nomes de coluna/tabela do núcleo são estáveis, mas o `contentTypeEnum` e as tabelas `<type>_facets` variam por cliente.
- Arquivos afetados: `lib/auth/guards.ts`, `lib/auth/session.ts`, `lib/content/{entries,published,media-urls,locales,translations}.ts`, `lib/users/service.ts`, `lib/webhooks/dispatch.ts`, `lib/audit/log.ts` (+ os `lib/supabase/*` que `guards` puxa).
- **Ponto sensível:** `guards.ts` lê `profiles` via a conexão de **conteúdo** (`DATABASE_URL`), validando o JWT localmente (JWKS/ES256, sem round-trip). No caso Neon (D5), `profiles` mora no Neon junto do conteúdo — a ponte com o Supabase é o **valor** do UUID (`claims.sub == profiles.id`), sem FK cross-DB (§13.4).
- **Nome de pacote inválido:** `@cms-core` sozinho é só um **escopo** npm — `import "@cms-core/config"` não resolve como subpath de um pacote chamado `@cms-core`. Hoje está contornado por **três aliases paralelos** (tsconfig `paths`, webpack `next.config.mjs`, vitest `vitest.config.ts`) que apontam `@cms-core/*` → `packages/core/src/*`. O `package.json` do core declara `"name": "@cms-core"` com um mapa de `exports` (`.`, `./config`, `./engine`, `./media`) que **nenhum resolver honra**, porque `@cms-core` não é um nome de pacote instalável.

---

## Decisão 1 — Contrato de injeção `db`+schema: **factory `createEngine({ db, schema })` sobre um Port tipado do schema**

### Escolha

O core **não importa** `db` nem tabelas concretas. Cada módulo DB-coupled do core é uma **fábrica** que recebe, do cliente, a instância Drizzle e um objeto de schema que satisfaz um **Port** (interface tipada das tabelas que aquele módulo usa), e retorna as funções do motor já ligadas.

```ts
// @cms-core/engine — Port do schema (o CONTRATO que o schema do cliente deve satisfazer).
// Tipado com os inferidores do Drizzle para preservar tipos fortes de ponta a ponta.
import type { PgTableWithColumns } from "drizzle-orm/pg-core";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

/**
 * O schema que o motor de conteúdo exige do cliente. São EXATAMENTE as tabelas do
 * núcleo (nomes/colunas estáveis entre clientes). As tabelas variáveis por cliente
 * (contentTypeEnum, <type>_facets) NÃO entram no Port do engine base — o filtro de
 * facets é injetado à parte (ver "facets genéricas" abaixo).
 */
export interface EngineSchema {
  contentEntries: typeof import("./schema-shape").contentEntries;   // shape canônico declarado no core
  contentVersions: typeof import("./schema-shape").contentVersions;
  mediaAssets: typeof import("./schema-shape").mediaAssets;
  profiles: typeof import("./schema-shape").profiles;
}

/** Drizzle db genérico sobre o schema do cliente. */
export type EngineDb = PostgresJsDatabase<Record<string, unknown>>;

export interface EngineDeps {
  db: EngineDb;
  schema: EngineSchema;
  // colaboradores cross-module injetados (resolvem o acoplamento entries→audit/webhooks):
  audit: { writeAudit(input: AuditInput): Promise<void> };
  webhooks: { dispatchRevalidation(ev: RevalidationEvent): Promise<void> };
  facets?: FacetPort;   // opcional; ausente => coleção sem facets (ver Decisão 1, facets)
}

/** A fábrica: recebe as deps do cliente e devolve o motor já ligado. */
export function createEngine(deps: EngineDeps) {
  return {
    listEntries, getEntry, createEntry, updateEntry, publishEntry,
    unpublishEntry, deleteEntry, reorderEntries, addTranslation,
    listTranslations, listVersions, restoreVersion,
    // read API:
    listPublished, getPublished, serializeEntry,
  } as const;
  // cada função fecha sobre `deps` — o corpo é o de hoje, trocando `db`→deps.db,
  // `contentEntries`→deps.schema.contentEntries, etc. Zero mudança de lógica.
}
```

**Como o schema codegen'd da Fase 2 satisfaz o Port:** o núcleo (`content_entries`, `content_versions`, `media_assets`, `profiles`) tem **colunas estáveis** entre clientes — o codegen emite essas tabelas a partir de um molde fixo do core, então elas satisfazem `EngineSchema` estruturalmente por construção. O que varia (o literal do `contentTypeEnum` e as tabelas `<type>_facets`) **não** faz parte do `EngineSchema` base: o tipo da coluna `type` no Port é `string`-like (o union `ContentType` forte vive na borda, no `content-types.generated.ts` do cliente, e é passado como parâmetro), e as facets entram por um **`FacetPort`** separado.

**Facets genéricas (resolve o acoplamento `type === "case"`):** em vez de o core conhecer `caseStudyFacets`, o cliente injeta um `FacetPort` que o codegen da Fase 2 (R3/`gen-facets`) materializa por coleção:

```ts
export interface FacetPort {
  /** extrai as colunas text[] de um payload validado (hoje: extractCaseFacets). */
  extract(type: string, data: Record<string, unknown>): Record<string, string[]> | null;
  /** upsert das facets publicadas para uma entry (hoje: insert caseStudyFacets). */
  upsert(tx: EngineDb, type: string, entryId: string, facets: Record<string, string[]>): Promise<void>;
  /** predicados de filtro do read API por facet (hoje: arrayOverlaps(caseStudyFacets.*)). */
  filter(type: string, params: Record<string, string[]>): unknown[];
}
```

Na Fase 1 (antes do codegen), o cliente Demo Corp injeta um `FacetPort` **escrito à mão** que espelha o `case_study_facets` atual — comportamento byte-idêntico. Na Fase 2, o `gen-facets` passa a **gerar** esse `FacetPort` a partir de `collections[].facets`. O core nunca muda.

**Auth (`guards.ts`):** mesma fábrica — `createAuthGuards({ db, schema: { profiles }, supabase })`. `guards` recebe `db`+`profiles`+o factory do cliente Supabase (`createClient`). A leitura de `profiles` permanece na conexão de conteúdo (correto para D5). Nenhum hardcode de connection string; o `db` injetado já carrega a `DATABASE_URL` do cliente.

### Alternativas consideradas

| Opção | Por que NÃO |
|-------|-------------|
| **(b) Só interfaces/portas puras** (core define tipos, cliente injeta implementação de cada query) | Empurraria a lógica de query de volta para o cliente — perde-se a reutilização (o motor viraria interface vazia). Contradiz o objetivo da extração (a lógica de CRUD/publish/read-API é o que se quer compartilhar). |
| **(c) Generics parametrizando o schema inteiro** `Engine<TSchema extends EngineSchema>` sem factory | Tipos corretos, mas cada call-site do cliente teria de repassar `db`+schema em toda chamada (`listEntries(db, schema, type, opts)`) — ergonomia ruim e 52 call-sites a reescrever com ruído. A factory encapsula as deps **uma vez** e devolve a API limpa que os call-sites já usam. |
| **(d) Módulo singleton lendo `DATABASE_URL`** (core cria seu próprio `db`) | Quebra D4/D5 (o core teria uma conexão; o cliente, outra) e impede testes com db fake. Rejeitada. |

### Consequências

- **Positivas:** lógica de motor mora 100% no core; tipos fortes do Drizzle preservados (o `db` genérico + `$inferSelect` das tabelas do Port); `guards`/`entries`/`published` extraem sem hardcode; o codegen da Fase 2 satisfaz o Port por construção; o acoplamento `entries→audit/webhooks` some (injetados como colaboradores) — resolvendo também a inversão de dependência que travava mover `entries` antes de S1.4; testável com `db` fake.
- **Custo:** cada workspace-cliente ganha um `lib/core-runtime.ts` fino que instancia `createEngine`/`createAuthGuards` com o `db`+schema locais e re-exporta as funções (os call-sites atuais importam desse arquivo em vez de `@cms-core/engine` diretamente — mudança mecânica). Um shape canônico das 4 tabelas do núcleo (`schema-shape.ts`) passa a viver no core como **fonte de verdade estrutural** do Port (o codegen da Fase 2 gera contra ele).
- **Risco:** se o schema do cliente divergir do Port (coluna renomeada), o typecheck do workspace quebra na instanciação da factory — falha **cedo e local**, coberta pela CI de S1.5. Aceitável.

---

## Decisão 2 — Estrutura de pacote: **um único pacote renomeado `@cms-core/core` com subpath exports**

### Escolha

Renomear o pacote de `@cms-core` (nome inválido — só escopo) para **`@cms-core/core`** (escopo `@cms-core` + nome `core`), mantendo **um único workspace** em `packages/core`, com `exports` por subpath:

```jsonc
// packages/core/package.json
{
  "name": "@cms-core/core",
  "private": true,
  "exports": {
    ".":         { "types": "./src/index.ts",         "default": "./src/index.ts" },
    "./config":  { "types": "./src/config/index.ts",  "default": "./src/config/index.ts" },
    "./engine":  { "types": "./src/engine/index.ts",  "default": "./src/engine/index.ts" },
    "./auth":    { "types": "./src/auth/index.ts",     "default": "./src/auth/index.ts" },
    "./media":   { "types": "./src/media/index.ts",    "default": "./src/media/index.ts" },
    "./i18n":    { "types": "./src/i18n/index.ts",      "default": "./src/i18n/index.ts" },
    "./webhooks":{ "types": "./src/webhooks/index.ts",  "default": "./src/webhooks/index.ts" },
    "./audit":   { "types": "./src/audit/index.ts",     "default": "./src/audit/index.ts" },
    "./ui":      { "types": "./src/ui/index.ts",        "default": "./src/ui/index.ts" }
  }
}
```

**Import surface final:** `@cms-core/core`, `@cms-core/core/config`, `@cms-core/core/engine`, `@cms-core/core/auth`, `@cms-core/core/media`, etc. Agora **resolvíveis nativamente** — `@cms-core/core` é um nome de pacote válido, e os subpaths batem no campo `exports`.

**Aliases que somem:** os três aliases paralelos que hoje contornam o nome inválido tornam-se **desnecessários** assim que o pacote tem nome válido + `exports`:
- `clients/demo-corp/tsconfig.json` → remover o bloco `paths` de `@cms-core*` (o TS resolve por `exports` com `moduleResolution: "bundler"`, já configurado).
- `clients/demo-corp/next.config.mjs` → remover o `webpack.alias` de `@cms-core*`; **manter** `transpilePackages: ["@cms-core/core"]` (o core é TS-fonte, precisa transpilar).
- `clients/demo-corp/vitest.config.ts` → remover os `find/replacement` de `@cms-core*`; manter só os shims de `next/headers`/`server-only` e o alias `@/`.

O `TEMPORARY: --db=…` não se aplica aqui; o único ajuste transversal é o **rename** (52 sites de import `@cms-core/…` → `@cms-core/core/…`, mecânico).

### Alternativas consideradas

| Opção | Por que NÃO |
|-------|-------------|
| **(b) Múltiplos pacotes** `@cms-core/engine`, `@cms-core/auth`, `@cms-core/config`, … (cada um um workspace em `packages/`) | Válido, e é a evolução natural se o core crescer. Mas hoje introduz **versionamento interno e grafo de deps entre pacotes** (engine depende de config, auth de engine…) — overhead sem retorno para poucos clientes e um operador (mesma lógica que fundamentou D1 monorepo). Rejeitada **por ora**; reabrir se um módulo precisar de ciclo de release próprio. |
| **Manter `@cms-core` + só aliases** (status quo) | É exatamente o workaround frágil que trava: três configs a manter em sincronia, quebra em qualquer ferramenta nova (Turborepo, tsc de build, IDEs), e o `exports` do `package.json` fica morto. Rejeitada. |

### Consequências

- **Positivas:** import resolve nativamente (Node/webpack/vitest/tsc/IDE); os três aliases somem (−3 pontos de manutenção); o `exports` passa a ser a **única** fonte de verdade do surface público; consistente com D1 (workspace linkado por `workspace:*`, `private:true`, sem registry).
- **Custo:** rename mecânico de 52 imports + `"@cms-core/core": "workspace:*"` nos `package.json` dos workspaces; `ClientConfig.coreVersion` continua `"workspace:*"`; exemplos do doc que citam `import ... from "@cms-core/config"` passam a `@cms-core/core/config`.
- **Reversível:** migrar depois para multi-pacote (opção b) é aditivo — cada subpath vira um pacote; os call-sites mudam de `@cms-core/core/engine` para `@cms-core/engine`.

---

## Decisão 3 — Sequenciamento: **completar S1.3/S1.4 agora com o contrato de injeção, usando o schema atual do Demo Corp como implementação concreta**

### Escolha

Opção **(a)**: extrair TODO o motor DB-coupled na Fase 1, com o contrato da Decisão 1, injetando o **schema atual escrito à mão** do Demo Corp (que já existe e está verde) como implementação concreta do Port. O codegen da Fase 2 depois **gera** o que hoje é injetado à mão — sem tocar no core.

**Racional:** o contrato de injeção é **ortogonal** ao codegen. O Port (`EngineSchema`/`FacetPort`) é satisfeito igualmente por um schema escrito à mão (hoje) ou codegen'd (Fase 2). Adiar a extração para a Fase 2 (opção b) deixaria a Fase 1 entregando um core pela metade (config+media+engine-puro) e **manteria o motor DB-coupled preso no workspace do cliente** — exatamente o acoplamento que a fábrica precisa eliminar. Pior: a Fase 2 (R1–R4) assume o motor **já no core** para generalizar facets/enum; começar a Fase 2 com metade do motor fora do core inverte a ordem R1→R2→R3.

Isso **preserva o gate gold-standard (S0.3)** e o CI (S1.5) como guarda-costas: a injeção é capability-preserving (mesma lógica, mesmo schema), então o snapshot S0.3 e o teste de equivalência continuam verdes; a CI de S1.5 pega qualquer regressão em todos os `clients/*` antes do deploy.

### Backlog re-sequenciado (Fase 1)

Insere-se **S1.3-DI** (esta ADR materializada como spec) e reescreve-se S1.3/S1.4 para consumir o contrato:

| Story | Mudança |
|-------|---------|
| **S1.3a (novo)** — Contrato de injeção `db`+schema no core | Implementa Decisão 1: `EngineSchema`/`FacetPort`/`EngineDeps`, `createEngine`, `createAuthGuards`, `schema-shape.ts` (shape canônico do núcleo), + o rename da Decisão 2 (`@cms-core/core` + exports; remover os 3 aliases). AC: core compila com o contrato; nenhum import de `@/db`/tabela concreta no core; import resolve sem alias. Dep: S1.2. |
| **S1.3b** (era S1.3) — Extrair engine(núcleo)+auth+media via contrato | Mover `entries`, `published`, `media-urls`, `guards`, `session`, `supabase/*`, `users/service` para o core como factories; o cliente ganha `lib/core-runtime.ts` que instancia com o schema local. AC: 4 gates verdes; S0.3 intacto. Dep: S1.3a. |
| **S1.4** (inalterada no objetivo) — Extrair i18n+webhooks+audit+ui | `audit`/`webhooks` viram colaboradores injetados em `EngineDeps` (resolve a inversão que travava `entries`). `i18n` (`locales`/`translations`) segue o mesmo contrato de injeção. Dep: S1.3b. |
| **S1.5** (inalterada) — CI anti-blast-radius | Guarda-costas; roda typecheck+testes de todos os `clients/*` a cada mudança no core. Dep: S1.4. |

**Fase 2 (R1–R4) — ajuste de framing (não de escopo):** as stories S2.1–S2.6 permanecem, com uma linha a mais: o `gen-facets` (S2.5) passa a **gerar o `FacetPort`** que S1.3b injetou à mão; o `gen-enums`/`gen-content-types` (S2.3) geram o `content-types.generated.ts` que alimenta a borda tipada (`ContentType`). O core **não muda** na Fase 2 — só a origem das implementações injetadas passa de manual para gerada. R3 (facets por coleção) fica mais simples porque o ponto de injeção já existe.

Contagem: Fase 1 passa de **5 → 6 stories** (S1.3 vira S1.3a+S1.3b); total do backlog **35 → 36**.

### Alternativas consideradas

| Opção | Por que NÃO |
|-------|-------------|
| **(b) Mover engine/auth/webhooks/audit acoplado para o início da Fase 2** (Fase 1 = monorepo + core não-acoplado + CI) | Deixa o core incompleto e o motor preso no cliente; a Fase 2 (R1–R4) precisa do motor **já no core** para generalizar — inverteria R1→R2→R3. E adiar não elimina o problema de design (esta ADR), só o empurra. Rejeitada. |

### Consequências

- **Positivas:** Fase 1 entrega um core **completo e desacoplado**; a Fase 2 fica puramente sobre codegen (gerar o que já é injetável); ordem R1→R2→R3 preservada; gold-standard e CI intactos.
- **Custo:** +1 story na Fase 1 (S1.3a); o `FacetPort` e o `content-types` do Demo Corp são escritos à mão uma vez (depois substituídos por gerados) — trabalho descartável mas pequeno e coberto por testes.

---

## Ações de acompanhamento

- **@sm** re-drafta: **S1.3a** (novo — contrato de injeção + rename do pacote), **S1.3b** (reescrita de S1.3 para extrair via factory), e ajusta **S1.4** (audit/webhooks como colaboradores injetados; i18n via contrato). Nenhuma mudança de AC em S1.5.
- **Atualizações do doc de arquitetura** (feitas nesta mesma passada): §5.5 (contrato de injeção), §6 (como o codegen satisfaz o Port), §8 (nome `@cms-core/core` + exports + aliases removidos), §10 (Fase 1 re-sequenciada), Changelog (2026-08-03).
</content>
</invoke>
